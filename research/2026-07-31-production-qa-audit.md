# Production QA audit — 2026-07-31

Adversarial pre-release testing of Ori Studio. Goal: break things before a wider
audience does.

**This file is the tracker.** Section "Progress tracker" below is the live
status of the fix work; everything after it is the original audit, kept as the
evidence each finding rests on.

Last updated: 2026-08-05, after #203–#206 merged.

## Known tooling limitations (NOT bugs)

These are constraints of the automated browser pane, not product defects. Nothing
here is reported as a bug.

- The browser pane runs with `visibilityState=hidden` and **zero rAF ticks**.
  Anything driven by an animation frame — WebGL canvas paint, camera orbit,
  simulator playback, inline simulation — cannot be visually verified there.
  Store actions and debug hooks still work.
- No native file dialogs. Tauri-only paths (native menus, OS dialogs, window
  chrome) are out of reach from the web preview.
- Screenshots of the pane may show a blank canvas for the reason above.

## Status legend

| Mark | Meaning |
| --- | --- |
| PASS | Tested, behaved correctly |
| BUG | Confirmed defect |
| SUSPECT | Plausible defect, not yet confirmed |
| N/A | Blocked by a tooling limitation above |

## Progress tracker

**7 of 22 findings fixed and merged.** All four critical/ship-blocker items
except #9 are done.

### Merged

| # | Finding | Sev | Plan | Pinned by | PR |
| --- | --- | --- | --- | --- | --- |
| 1 | `prepareFoldModel` O(faces x vertices) — 1191 ms -> 46 ms | high | — | `prepareScaling.test.ts` ratio gate | [#203](https://github.com/zacharyfmarion/ori-studio/pull/203) |
| 2 | CI never ran the simulator tests | high | — | the CI step itself | [#203](https://github.com/zacharyfmarion/ori-studio/pull/203) |
| 4 | Failed CP load replaced by a blank doc, error erased | critical | `failed-load-error-surfacing.md` | 3 store tests | [#204](https://github.com/zacharyfmarion/ori-studio/pull/204) |
| 3 | Spec-valid multi-frame `.fold` rejected | critical | `fold-import-integrity.md` | 7 fixtures, exact segment counts | [#206](https://github.com/zacharyfmarion/ori-studio/pull/206) |
| 5 | Malformed vertex shifts every later index | high | `fold-import-integrity.md` | vertex-integrity test | [#206](https://github.com/zacharyfmarion/ori-studio/pull/206) |
| 6 | Invalid edge shifts every later assignment | medium | `fold-import-integrity.md` | assignment-alignment test | [#206](https://github.com/zacharyfmarion/ori-studio/pull/206) |
| 7 | Cyclic `frame_parent` blows the stack | medium | `fold-import-integrity.md` | cyclic-frame test | [#206](https://github.com/zacharyfmarion/ori-studio/pull/206) |

Measured effect of #3/#5/#6/#7 on a 90-file third-party FOLD corpus: **53 -> 86
files importing**.

### Next

| # | Finding | Sev | Plan | State |
| --- | --- | --- | --- | --- |
| 9 | BP optimizer abort hangs, modal unclosable | critical | `bp-optimizer-cancellation.md` | plan written, reproduced end-to-end, **not started** |

### Not started (no plan yet)

| # | Finding | Sev |
| --- | --- | --- |
| 8 | `.ori` save drops reference images | high |
| 10 | `.tmd5`/`.bps` from Welcome hidden behind the design chooser | high |
| 11 | Undo history uncapped | high |
| 12 | Delete/Backspace dead in the Design + 2 BP panes | high |
| 13 | Per-segment export drops non-flat fold angles | medium |
| 14 | A failed File > Open leaves the CP permanently uneditable | medium |
| 15 | BP optimizer spins forever when no candidate packs (`optimizer.rs:1370`) | medium |
| 16 | Shortcuts fire while a modal is open | medium |
| 17 | Shortcut conflict detection ignores `global` scope | medium |
| 18 | Build CP leaves the previous document's overlays behind | medium |
| 19-22 | see the findings table below | low |

### Carried forward

Deferred deliberately, each with a reason recorded where it belongs:

- **Surface importer `diagnostics.warnings`.** The importer records "Some FOLD
  vertices/edges were ignored…" and nothing reads it, so a *partially* dropped
  import still looks clean. Tracked in `fold-import-integrity.md`.
- **Move the vertex-index remap into `foldEdgeArrays.ts`.** That module's
  contract is per-*edge* arrays; folding in a vertex invariant deserves its own
  review. Raised in #206.
- **Golden-trace portability.** Making them run on CI means choosing a
  tolerance, which changes what the oracle asserts. See BUG-2 below.
- **Layout regression coverage.** No harness can catch the CSS collapse today;
  options are in `failed-load-error-surfacing.md`.

### Regression coverage

Every fix is pinned by a test that was confirmed to **fail without it** — either
written red first, or verified by swapping the pre-fix code back in.

| # | Pinned by | Confirmed red without the fix |
| --- | --- | --- |
| 1 | `tests/prepareScaling.test.ts` — ratio gate, not a wall-clock budget | yes — 30.7x vs a threshold of 12 |
| 2 | the CI step itself | n/a |
| 3 | `tests/fixtures/fold-frames/` + `fold_frame_corpus.rs`, exact segment counts | yes — `missing field edges_vertices` |
| 4 | 3 store tests in `store.test.ts` | yes — written red first |
| 5 | `creasePatternImport.test.ts` vertex-integrity case | yes — written red first |
| 6 | `creasePatternImport.test.ts` assignment-alignment case | yes — written red first |
| 7 | `creasePatternImport.test.ts` cyclic-frame case | yes — written red first |

Two deliberate gaps, both recorded rather than papered over:

- **The CSS half of #4 is browser-verified only.** The web suite runs under
  jsdom, which has no layout engine, so "collapses to 0x0" cannot be made to
  fail and then pass. See `failed-load-error-surfacing.md`, "Test
  infrastructure gap".
- **The simulator golden traces do not run on CI.** They compare bit-exactly,
  which is not portable across libm implementations. See BUG-2 below.

Note on #1: raising the package test timeout so the suite could run on CI
*removed* an accidental gate — the quadratic used to blow vitest's 5s default.
The ratio test replaces it with a deliberate one.

## 0. Post-merge re-validation (2026-08-05)

`origin/main` merged in (228 commits, clean, no conflicts — main never touched
`prepare.ts`). Baseline re-run after `npm install` + simulator rebuild:
`tsc --noEmit` clean, simulator 245 passed / 1 skipped.

Every critical finding was re-tested against the merged tree. **All still
reproduce**, with mechanisms unchanged:

| Bug | Relevant file moved on main? | Still reproduces |
| --- | --- | --- |
| BUG-3 multi-frame `.fold` rejected | `treemaker-fold/src/lib.rs` — 0 commits | yes |
| BUG-4 failed load -> blank doc, error erased | `creasePatternSlice.ts` +18, `projectSlice.ts` +28 | yes — guard unchanged |
| BUG-5 malformed vertex destroys geometry | `creasePatternImport.ts` — 0 commits | yes |
| BUG-6 invalid edge shifts assignments | `creasePatternImport.ts` — 0 commits | yes |
| BUG-7 cyclic `frame_parent` | `creasePatternImport.ts` — 0 commits | yes |
| BUG-9 BP optimizer abort hangs | `oristudioBpRuntime.ts` +5 | yes — now reproduced end-to-end |

BUG-9 was previously agent-verified only; it is now **reproduced directly** (see
`implementation-plans/bp-optimizer-cancellation.md`). `ensureEditCreasePattern`
grew share-link handling on main but its guard is still `if
(get().oristudioCpDocument)`, and `discardCpDocumentState` still nulls both
`importedCreasePattern` and `oristudioCpError`.

Implementation plans written:

- `implementation-plans/fold-import-integrity.md` — BUG-3, BUG-5, BUG-6, BUG-7
- `implementation-plans/failed-load-error-surfacing.md` — BUG-4
- `implementation-plans/bp-optimizer-cancellation.md` — BUG-9

## 1. Baseline automated checks

| Check | Command | Result |
| --- | --- | --- |
| Web typecheck | `npx tsc --noEmit` (apps/web) | PASS |
| Web lint | `npx eslint .` (apps/web) | PASS |
| Web unit tests | `npx vitest run` (apps/web) | PASS — 186 files, 1799 tests |
| Simulator tests | `npx vitest run` (packages/origami-simulator) | **FAIL — 3 timeouts** → see BUG-1 |
| Rust workspace | `cargo test --workspace` | PASS — 123 test binaries |

## 2. Findings

### Summary

Confidence column: **reproduced** = I triggered it and observed the failure;
**code-verified** = proven by reading the implementation, not executed;
**agent-verified** = found by a hunter agent and upheld by an independent
adversarial verifier, but not reproduced by me.

Severities below are post-verification (an adversarial verifier corrected several
of the hunters' original ratings downward; those are shown as `orig -> final`).

| # | Severity | Finding | Confidence |
| --- | --- | --- | --- |
| 1 | high | `prepareFoldModel` O(faces x vertices) — **fixed**, 1191 ms -> 46 ms | reproduced |
| 2 | high | CI never runs the simulator package tests (3 were failing) | reproduced |
| 3 | critical | Spec-valid multi-frame `.fold` rejected: `vertices_coords`/`edges_vertices` required on every frame | reproduced |
| 4 | critical | A failed CP load is replaced by a blank document and the error is erased | reproduced |
| 5 | high | One malformed `.fold` **vertex** shifts every vertex index — geometry silently destroyed | reproduced |
| 6 | medium (was high) | One invalid `.fold` **edge** shifts every later assignment — valleys import as mountains | reproduced |
| 7 | medium | Cyclic `frame_parent` blows the stack | reproduced |
| 8 | high (was critical) | Cmd+S over an opened `.ori`/`.orh` silently drops images, rich text, sim windows, non-flat fold angles | code-verified |
| 9 | critical | Aborting the Box-Pleat layout optimizer leaves an unclosable modal blocking the app | agent-verified |
| 10 | high (was critical) | Opening `.tmd5`/`.bps` from Welcome lands on the design chooser, hiding the opened file | agent-verified |
| 11 | high | Undo history is uncapped — a full document snapshot retained per edit | agent-verified |
| 12 | high | Delete/Backspace dead in the Design, BP tree and BP packing panes | agent-verified |
| 13 | medium (was high) | Per-segment export to `.cp`/`.ori`/`.orh` drops non-flat fold angles silently | agent-verified |
| 14 | medium (was high) | A failed File > Open leaves the previous CP on screen but permanently uneditable | agent-verified |
| 15 | medium | BP layout optimizer spins forever when no random candidate can be packed (`optimizer.rs:1370`) | agent-verified |
| 16 | medium | Shortcuts (incl. destructive Delete) fire while a modal dialog is open | agent-verified |
| 17 | medium | Shortcut conflict detection treats `global` as overlapping nothing — a custom binding can silently kill Cmd+S | agent-verified |
| 18 | medium | Build Crease Pattern leaves the previous document's images/text/sim windows behind | agent-verified |
| 19 | low (was medium) | Cancelling Open on the design chooser drops the user into an empty tree editor | agent-verified |
| 20 | low (was medium) | Engine-init failure + return to start screen = dead-end app, all actions disabled | agent-verified |
| 21 | low | Escape while recording a shortcut closes the whole Settings dialog | agent-verified |
| 22 | low | CJK/wide-glyph caption text overflows and is clipped in exported SVG/PNG | agent-verified |

The hunt produced 22 claims; 17 survived adversarial verification. Five were
refuted and are not listed — a shortcut-rebinding claim, a toast-discard claim,
a "Clear button does nothing" claim, and two whose framing was wrong but whose
underlying defect is real (see #5 and #7, both of which I then reproduced
myself — the verifier was wrong to refute #5, and right that #7 is not a
"hang").

### BUG-5 — one malformed `.fold` vertex shifts every later vertex index, silently destroying geometry

**Severity: high** (silent data corruption presented as a successful open)
**File:** `apps/web/src/lib/creasePatternImport.ts:391-394`

Same root cause as BUG-6 but a wider blast radius: `vertices_coords` is filtered
in place (dropping entries that are short, non-numeric, or non-finite) while
`edges_vertices` still holds indices into the **original** array. Every vertex
after the dropped one shifts down by one, so edges silently re-point at the
wrong vertices, and edges whose indices now exceed the shortened array are
discarded.

The trigger vertex does not even have to be used. Reproduced with a plain square
(`v0,v2,v3,v4`) plus one isolated vertex `v1` that no edge references and that
lies on no edge:

| input | vertices out | edges out | shape |
| --- | --- | --- | --- |
| `v1 = [90,310]` (valid) | 4 — `(0,0) (1,0) (1,1) (0,1)` | 4 — closed | correct square |
| `v1 = [400]` (short) | **3** — `(1,0)` gone | **2** — open | not a polygon |
| `v1 = ["x","y"]` | **3** | **2** | not a polygon |

A corner of the sheet disappears, half the boundary disappears, and the document
degrades to an open polyline — the extra warnings say
`"No bounded faces could be inferred; simulation is unavailable"`. All of it from
one decorative vertex the pattern never used.

Note this contradicts one of the hunt's verifiers, which refuted the claim. The
table above is a direct execution of `parseImportedCreasePattern`, so the claim
stands.

Both this and BUG-6 are one defect: **an array is filtered without remapping the
indices that reference it.** The correct pattern already exists in the same file
— `inferTopology` threads a `sources` provenance array through
`remapEdgeExtensionArrays`.

### BUG-6 — one invalid `.fold` edge silently mis-assigns mountain/valley on every later crease

**Severity: medium** (wrong result — the model folds incorrectly; hunter rated
this high, the verifier corrected it to medium because the trigger is a
malformed file rather than mainstream generator output. The consequence is still
corruption, and it reaches disk — see below.)
**File:** `apps/web/src/lib/creasePatternImport.ts:394-400`

The importer drops edges that reference invalid vertices, but `edges_assignment`
stays aligned to the **original** edge indices, so every assignment after the
dropped edge shifts by one.

Reproduced against `parseImportedCreasePattern` with five edges carrying
distinct assignments (`B,M,V,B,F`), edge index 1 made invalid:

| | `[0,1]` | `[0,2]` | `[0,3]` | `[2,3]` |
| --- | --- | --- | --- | --- |
| control (all edges valid) | B | F | B | V |
| one invalid edge dropped | B | **B** | **V** | **M** |

Three of the four surviving creases get the wrong type — including a valley
imported as a mountain. For an origami tool this is the worst kind of wrong
result: it is not visibly broken, it just folds wrong.

A diagnostic *is* recorded ("Some FOLD edges were ignored because they
referenced invalid vertices") — but per BUG-4 that warning is wiped before any
user sees it.

Two aggravating details the verifier established:

- The corruption **reaches disk**. File > Export FOLD with no kernel document
  writes `JSON.stringify(importedCreasePattern.fold)` verbatim
  (`projectSlice.ts:2203-2204`), so the shifted assignments are saved out as if
  correct.
- It becomes authoritative in exactly the case that triggers it. The Rust kernel
  *does* reject such a file, and `projectSlice.ts:902` then installs the
  importer's shifted fold as the ready artifacts — whereas on a successful kernel
  load the importer's fold is discarded.

### BUG-7 — a cyclic `frame_parent` blows the stack

**Severity: medium** (crash on malformed input)
**File:** `apps/web/src/lib/creasePatternImport.ts:342`

The FOLD frame resolver follows `frame_parent` with no cycle detection.
Reproduced:

| input | result |
| --- | --- |
| root frame with `frame_parent: 0` | ok (3 edges, 2 frames) |
| frame whose `frame_parent` is itself | `Maximum call stack size exceeded` (2 ms) |
| two frames pointing at each other | `Maximum call stack size exceeded` (2 ms) |

It throws rather than hanging, and `loadCreasePattern` catches it — so the
immediate blast radius is one failed open, then BUG-4's blank-document
substitution. Fix is a visited-set in the parent walk.

### BUG-8 — Cmd+S over an opened `.ori` silently drops reference images

**Severity: high** (data loss; hunter rated critical, verifier corrected to high)
**File:** `apps/web/src/store/workspaceStore/slices/projectSlice.ts:1454-1456`

`saveEditableCreasePattern` routes by the current filename:

```ts
if (!forceSaveAs && isOrieditaOriFilename(get().currentFileName)) {
  return saveEditableCreasePatternAsOri(fileService);   // no confirmation
}
if (!forceSaveAs && isOrieditaOrhFilename(get().currentFileName)) {
  return saveEditableCreasePatternAsOrh(fileService);   // confirmLossyOrhWrite()
}
```

`.orh` gets a danger-toned confirmation warning that the format "cannot preserve
Ori Studio workspace state, embedded FOLD frames, or all modern editor
metadata". `.ori` gets **none** — yet `crates/oristudio-cp/src/io/ori.rs` has no
image handling at all, while reference images are an advertised superset feature
that only `.osf` stores (`nativeProjectFile.ts:81-85`).

So: open a `.ori`, place reference images, press Cmd+S. The images are gone, and
`saveEditableCreasePatternAsOri` then sets `dirty: false`, so nothing ever
signals the loss. Rich-text annotations survive only as flattened plain text.

The asymmetry with `.orh` is the tell — the team already treats this class of
save as lossy and gates it; `.ori` was missed.

### BUG-1 — `prepareFoldModel` is O(faces x vertices); triangulation dominates model load — FIXED

**Severity: high** (perf / user-visible stall on the file-open path)
**File:** `packages/origami-simulator/src/prepare.ts`

`triangulateQuad` calls `smallestAngleOf` twice per quad, and `smallestAngleOf`
called `degenerateCrossThreshold(fold)` -> `boundingDiagonal(fold)`, which is a
full O(V) scan that allocates a normalised point per vertex. Triangulating a
quad-heavy mesh therefore did `2 x quads x vertices` work — ~84M point
allocations for an 80x80 Miura.

`triangulateFold` never adds or moves a vertex (`removeRedundantVertices`, the
only pass that does, finishes first at `prepare.ts:121`), so the value is
invariant across the loop and was being recomputed for nothing.

Measured on the built `dist`, `prepareFoldModel(..., {triangulate:true})`:

| Fixture | faces | verts | before | after |
| --- | --- | --- | --- | --- |
| miura-32x32 | 2048 | 1089 | 44 ms | 18 ms |
| miura-56x56 | 6272 | 3249 | 311 ms | 30 ms |
| miura-80x80 | 12800 | 6561 | **1191 ms** | **46 ms** |

Quadratic -> linear; 6.4x on the profiled case, and the gap widens with size.
CPU profile attributed 413 ms of 590 ms self-time to `boundingDiagonal`, plus
122 ms of GC from its per-vertex allocations.

**Why it matters for release:** this is not only worker-side. `prepareFoldModel`
is called twice by `prepareSimulationFold` in
`apps/web/src/lib/creasePatternImport.ts:538,545`, reached from main-thread store
code on file open (`projectSlice.ts`, `fileDrop.ts`, `nativeProjectFile.ts`).
`projectSlice.ts:2412` already describes it as "the multi-second
prepareSimulationFold path". The worker comment at `simulatorSession.ts:569`
asserts the pass is "O(n) heavy" — that assumption was wrong.

**Fix applied:** hoist `degenerateCrossThreshold(fold)` to the top of
`triangulateFold` and thread it through `triangulateQuad` -> `smallestAngleOf`.
Value-identical, so no behaviour change.

**Verification:** simulator suite 245 passed / 1 skipped (was 3 failed);
`apps/web` `tsc --noEmit` clean and 1799 tests pass against the rebuilt package.

### BUG-2 — the simulator package's tests are not run by CI

**Severity: high** (process — this is why BUG-1 shipped as a red suite)

`.github/workflows/` contains no reference to `test:simulator` or the
`origami-simulator` package. `ci.yml`'s `web-client` job runs web lint,
typecheck, and tests only. So `packages/origami-simulator` had **3 failing
tests on a green CI**, and its parity/invariant gates — the fixture set,
upstream parity, NaN guards — provide no release protection today.

Recommend adding `npm run test:simulator` to the `web-client` job.

**Update (2026-08-05, from actually doing it in #203).** The suite was not merely
unwired — it was **not CI-runnable**, which is a bigger finding than the original
one. Adding the step turned it red for two reasons, neither related to the change
under test:

1. **Timeouts.** The fixture suites run the CPU `ReferenceSolver` for hundreds of
   steps over meshes up to 6.5k vertices. They finish in ~2 s on a dev machine
   and exceed vitest's 5 s default on a runner.
2. **The golden traces are not portable.** They compare **bit-exactly**
   (`if (worst !== 0) throw`), which only holds on the machine that blessed them.
   `Math.hypot` / `Math.acos` are not identical across libm implementations, and
   1000 solver steps amplify a last-ulp difference. The runner diverged by ~1e-18
   on values that are themselves ~1e-17 — cancellation noise, not a solver
   change. Three traces failed while every other suite in the package passed.

Resolved in #203 by raising the package timeout and skipping the golden traces on
CI specifically, leaving local behaviour unchanged. They stay the local, exact,
deliberately-re-blessed oracle they were designed to be.

**Open question for the team:** making the goldens portable means choosing a
tolerance, which changes what the oracle asserts. A real solver regression moves
positions by orders of magnitude more than 1e-18, so a small absolute tolerance
would keep the gate meaningful *and* let it run in CI — but that is a deliberate
call about someone's designed invariant, not a side effect of wiring up CI.

### BUG-3 — a valid multi-frame `.fold` file fails to import: `vertices_coords` / `edges_vertices` are required on every frame

**Severity: critical** (interop / file will not open)
**File:** `crates/treemaker-fold/src/lib.rs:157-158`

Every field of `FoldDocument` carries `#[serde(default)]` **except** these two:

```rust
pub vertices_coords: Vec<Vec<f64>>,   // no #[serde(default)]
pub edges_vertices: Vec<[usize; 2]>,  // no #[serde(default)]
```

`file_frames` is a `Vec<FoldDocument>`, so the requirement applies to the root
**and to every embedded frame**. The FOLD spec treats both as optional, and two
of the most common real-world file shapes omit them. Proven directly against
`oristudio_cp::io::fold::import_fold_file_document_json`:

| Input | Result |
| --- | --- |
| Canonical multi-frame (metadata at root, geometry in `file_frames[0]`) — what Rabbit Ear emits | `JSON error: missing field vertices_coords` |
| Valid root geometry + a `foldedForm` frame that omits `edges_vertices` | `JSON error: missing field edges_vertices` |
| Plain single-frame FOLD (control) | ok, 4 segments |

The second row is the worst: the root geometry is entirely valid and the file is
still rejected, because one *sibling frame* omitted an inherited field.

`.fold` is the interchange format between origami tools, so this is likely to be
hit by a large fraction of files users bring from elsewhere.

**Fix:** add `#[serde(default)]` to both fields, and reject empty geometry with a
real error at the semantic layer rather than at deserialization.

### BUG-4 — a failed CP load is replaced by a blank document and the error is erased

**Severity: critical** (silent failure — user cannot tell their file did not open)
**File:** `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:890`

`loadCreasePattern` handles a kernel rejection correctly: it keeps the read-only
JS-parsed import, records the reason in `oristudioCpError`, and moves the active
panel to `design` (`projectSlice.ts:834-861,900-920`). That careful fallback is
then destroyed a moment later.

`ensureEditCreasePattern` seeds a blank CP whenever the Edit workspace has no
document, and its only guard is:

```ts
if (get().oristudioCpDocument) return;
```

It does not ask *why* there is no document. After a failed load there is none, so
it provisions a blank one via `freshEditableCpState` -> `discardCpDocumentState`,
which explicitly sets `importedCreasePattern: null` **and**
`oristudioCpError: null` (`cpDocumentState.ts:73,77`).

Observed state trace for one rejected `.fold` (subscribe to the store across a
single `loadCreasePatternText`):

| # | status | cp doc | error | read-only import | panel |
| --- | --- | --- | --- | --- | --- |
| 1 | `loading_engine` | — | — | — | crease-pattern |
| 2 | `crease_pattern_ready` | **none** | `"invalid Oriedita field vertices_coords: edge references miss…"` | **yes** | design |
| 3 | `crease_pattern_ready` | **blank (4 segs)** | **null** | **no** | crease-pattern |

Row 3 is the auto-provisioner overwriting row 2.

What the user sees: an empty crease pattern, **no error anywhere in the UI**, the
window titled with their filename, and the store still pointing at their file:

```
windowTitle:     "MyDesign - Ori Studio"
currentFileName: "MyDesign.fold"
currentFilePath: "/Users/me/MyDesign.fold"
oristudioCpDocument.document.title: "Untitled CP"   // blank starter, 4 boundary segs
oristudioCpError: null
```

The only trace is a `console.error("[cp-load] … loaded read-only: the editable
kernel refused it")` that no user will see.

Combined with BUG-3, the headline behaviour is: **a spec-valid multi-frame FOLD
file opens as a blank sheet named after the user's file, with no error.**

**Not** a save-overwrite: `nativeSaveTarget()` gates on `isNativeProjectFilename`,
so File > Save on a `.fold` forces Save-As to `.osf` rather than writing over the
original. Checked, and the `.ori`/`.orh` failure path is also clean (it rethrows,
status stays `error`, and `currentFilePath` is left on the previous document).
The damage here is silent non-loading and a misleading UI, not file destruction.

**Fix:** make the guard consider failure state — skip auto-provisioning when
`oristudioCpError` is set or a read-only `importedCreasePattern` is present, and
surface the kernel's reason in the UI instead of only the console.

### NOT-A-BUG — CP open time tracks the *output* mesh, not the input size

Worth writing down because the first measurement looked like a quadratic defect
and was not.

Opening a synthetic CP of full-width crossing lines scales ~O(n^1.9):

| input lines | open time |
| --- | --- |
| 202 | 1.3 s |
| 402 | 4.7 s |
| 602 | 10.1 s |

That is **correct behaviour**, not a bug. Every full-width line crosses every
other, so n lines produce ~n^2 intersections: the 602-line case really does build
90,601 vertices / 180,600 edges / 90,000 faces. The work is quadratic because the
*result* is.

Real crease patterns do not look like that — their creases meet at shared grid
vertices, giving faces/segments ~= 0.5. Re-measured with that ratio:

| segments | faces | parse time |
| --- | --- | --- |
| 144 | 64 | 8 ms |
| 544 | 256 | 23 ms |
| 1200 | 576 | 48 ms |
| 2112 | 1024 | 116 ms |

Near-linear, and 2112 segments — a large real pattern — parses in 116 ms **on the
dev server**, so production is faster still. CP open performance is fine.

The residual, narrower concern: `parseImportedCreasePattern` runs
**synchronously on the main thread** in `loadCreasePattern`, so for a genuinely
dense pattern the UI freezes with no feedback rather than showing progress. Only
reachable with unusually crossing-heavy patterns, but it is a hard freeze when it
happens. BUG-1's fix reduces this path's cost directly (it is the same
`prepareFoldModel` called twice by `prepareSimulationFold`).

Also confirmed: the Rust kernel is not involved in this cost at all — native
`load_cp` + `CheckCamv` + `document_geometry` all measure **0 ms** at 602 lines.

## 3. Test log

| # | Area | What was tested | Result |
| --- | --- | --- | --- |
| 1 | Build | web typecheck, web lint | PASS |
| 2 | Build | web unit tests (1799) | PASS |
| 3 | Build | Rust workspace tests | PASS |
| 4 | Build | simulator package tests | BUG-1 |
| 5 | CI | which suites CI actually gates on | BUG-2 |
| 6 | Perf | `prepareFoldModel` scaling 1k->6.5k verts | BUG-1, fixed + re-measured |
| 7 | Import `.cp` | 15 malformed inputs: empty, whitespace, NUL, BOM, truncated, NaN, Infinity, 1e308, 1e400, binary, emoji, CRLF, zero-length edge, negative/huge type | PASS — clean error each, no throw, no hang |
| 8 | Import `.fold` | 17 malformed inputs: bad JSON, null, array, out-of-range/negative vertex, mismatched arrays, string/null coords, 1-element edge, self-loop, dup edges, 3D coords, bad assignment | BUG-3 / BUG-4 |
| 9 | Import `.fold` | spec-valid multi-frame + root-plus-frame layouts | BUG-3 (rejected) |
| 10 | Import `.fold` | `U` (unassigned) creases, missing `edges_assignment`, CRLF | PASS |
| 11 | Import `.ori` | malformed text | PASS — status stays `error`, path not hijacked |
| 12 | State | store trace across a rejected load | BUG-4 |
| 13 | Save | whether a failed load can overwrite the source file | PASS — `Save` forces Save-As to `.osf` |
| 14 | Routing | `/edit`, `/simulate`, `/design`, `/welcome`, invalid `/nonsense-route` | PASS — invalid redirects to `/welcome` |
| 15 | Routing | deep link to `/simulate` with no document | PASS — "No crease pattern" empty state |
| 16 | Persistence | all 14 storage keys set to valid-JSON-wrong-shape, then reload | PASS — booted clean, no white screen |
| 17 | Persistence | corrupt dockview layout naming a non-existent panel | PASS — recovered |
| 18 | Editing | undo/redo x3 edits, over-undo x6, over-redo x6 | PASS — clamps correctly, no drift |
| 19 | Editing | dirty flag + `*` title marker | PASS |
| 20 | Safety | `beforeunload` guard when dirty vs clean | PASS — prompts only when dirty |
| 21 | Round-trip | FOLD export -> re-import, incl. embedded frames | PASS — frames preserved |
| 22 | Perf | CP open scaling, synthetic + realistic | NOT-A-BUG (see above) |
| 23 | Perf | native Rust `load_cp` / `CheckCamv` / geometry at 602 lines | PASS — 0 ms |
| 24 | Shortcuts | 172 definitions; built-in registry diagnostics + independent collision scan | PASS — no same-context duplicates; all collisions cross-context |
| 25 | Shortcuts | `Cmd+R` bound to `optimize.scale` | By design — classified `soft-reserved`, asserted in `shortcuts.test.ts:179` |
| 26 | Export | `escapeXml` in text + attribute contexts | PASS — exact round-trip |
| 27 | Export | SVG export with hostile title/subtitle (`</text><script>…& "q" <b>`) | PASS — parses, escaped, no injection |
| 28 | Export | audit of every SVG `<text>` emission site | PASS — both sites escape |
| 29 | Design | `optimizeScale` on an empty tree / no tree document | PASS — clean guarded errors |
| 30 | Design | `optimizeScale` with all edge lengths = 0 | PASS — engine error, blocked, recoverable |
| 31 | Design | `optimizeScale` with edge lengths = 1e12 | PASS — "ALM returned result code 1", 212 ms, no hang |
| 32 | Design | `optimizeScale` with negative edge lengths | PASS — blocked cleanly |
| 33 | Design | node coords finite after each optimize | PASS — no NaN |
| 34 | Design | node editing blocked while an imported CP is active | PASS — "Imported crease patterns are read-only" |
| 35 | Import `.fold` | assignment alignment after a dropped edge | BUG-6 |
| 36 | Import `.fold` | vertex-index alignment after a dropped vertex (clean, non-collinear geometry) | BUG-5 |
| 37 | Import `.fold` | cyclic / self-referencing `frame_parent` | BUG-7 |
| 38 | Save | `.ori` vs `.orh` lossy-write gating | BUG-8 |
| 39 | Static | 8-dimension adversarial hunt (import, export, store, routing, persistence, keyboard, error handling, Rust panics) | 22 claims, 17 upheld |

## 4. Suggested release triage

1. **Ship-blockers**
   - BUG-3 + BUG-4 together: a spec-valid third-party `.fold` opens as a blank
     sheet under the user's filename with no error anywhere.
   - BUG-5: one malformed vertex silently destroys sheet geometry.
   - BUG-9: aborting the BP optimizer leaves an unclosable modal blocking the
     whole app.
2. **Fix before a wide release**
   - BUG-8 (`.ori` save eats reference images — add the `.orh` confirmation).
   - BUG-6 (wrong M/V, and it reaches disk via Export FOLD).
   - BUG-10 (opened file hidden behind the design chooser).
   - BUG-11 (undo history uncapped — unbounded memory growth per edit).
   - BUG-12 (Delete/Backspace dead in three panes).
3. **One shared root cause worth fixing once:** BUG-5 and BUG-6 are both "filter
   an array, forget to remap the indices that reference it" in
   `creasePatternImport.ts`. `inferTopology`'s `sources`/`remapEdgeExtensionArrays`
   in the same file is the pattern to copy.
4. **Process:** BUG-2 — add `npm run test:simulator` to the `web-client` CI job
   first, or the next regression there is invisible again.
5. **Already fixed on this branch:** BUG-1.

## 5. Coverage gaps (not yet tested)

- Simulator runtime behaviour (playback, camera, GPU solver) — blocked by the
  zero-rAF limitation of the automated pane.
- Box-Pleat workspace interactively (the two BP optimizer findings are
  agent-verified, not reproduced here).
- Tauri desktop shell: native menus, OS dialogs, window lifecycle, `.osf` on
  large files.
- i18n: only English was exercised.
- `.osf` legacy-schema migration from older app versions.

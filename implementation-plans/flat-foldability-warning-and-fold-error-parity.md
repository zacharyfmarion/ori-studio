# Flat-Foldability Warning Dialog & Fold-Error Parity

## Goal

Reach parity with Oriedita's fold-error UX. Today, folding a problematic CP in Ori
Studio dead-ends at a raw toast — e.g.

> Ori Studio error
> `WorkerOverlap(AdditionalEstimation(Contradiction { upper_face: 15, lower_face: 12 }))`

Oriedita, by contrast:

1. **Before folding**, runs a flat-foldability pre-check and, if it finds
   violations, shows a modal — *"Detected errors in flat foldability. Continue to
   fold?"* with **No / Yes** and a **"Don't show this again"** checkbox.
2. On **Yes**, it folds anyway and **highlights the offending vertices** in the CP.
3. **During** the fold, if the layer-ordering estimate hits a contradiction, it
   does **not** error out — it fills the **offending faces red** on both the folded
   figure and the flat CP and still shows the (partial) result.

## The one thing to internalize: these are TWO separate mechanisms

The user's report conflates them, but Oriedita implements them independently, and so
must we. The raw toast the user actually hit is mechanism **B**, not **A**.

| | **A. Flat-foldability pre-check** | **B. Estimation contradiction** |
|---|---|---|
| Oriedita class | `Check4` → `FlatFoldabilityViolation` | `AdditionalEstimationAlgorithm` → `HierarchyListStatus.CONTRADICTED_*` + `errorPos` |
| When | *Before* folding, in `FoldAction` | *During* the folded-state estimate |
| Scope | Local, **per-vertex** (parity / Maekawa / Kawasaki / big-little-big) | Global **face** stacking order |
| Oriedita surfacing | **Modal** "Continue to fold?" + CP overlay glyphs (`DrawingUtil.drawViolation`) | **No modal**; red face fill on folded figure + CP (`drawSelfIntersectingSubFaces`), text on bulletin board |
| Ori Studio today | checks exist (`checks.rs`, Check1–4/CAMV) but are **never run before folding**; no dialog | `folding_estimated` returns a **hard `Err`** → raw toast, nothing rendered |
| Our Rust analog | `FlatFoldabilityViolation` (`checks.rs`) keyed by point | `AdditionalEstimationError::Contradiction { upper_face, lower_face }` |

Passing the pre-check does **not** guarantee the estimate succeeds, and clicking
"Yes" does **not** suppress an estimation contradiction. To match the described
experience end-to-end we need **both** features.

### This split is exactly local vs. global flat-foldability

- **A is LOCAL flat-foldability** — the per-vertex necessary conditions (Maekawa /
  Kawasaki / big-little-big / parity). Cheap to compute; necessary but **not
  sufficient**. This is what CAMV/Check4 covers and what the live overlay shows.
- **B is GLOBAL flat-foldability** — whether a consistent **layer ordering** exists.
  This is **not** a vertex property and is **not** in CAMV; the only way to know is to
  attempt the layer-ordering search — i.e. to fold. A CP can pass every local check
  and still be globally non-foldable (the `Contradiction`). Global foldability is
  **not displayed anywhere in Ori Studio today** — B is the feature that adds it.
- **Consequence:** the pre-fold **dialog is inherently local-only** (Oriedita's is —
  it gates on `Check4`). It cannot represent global foldability, because by the time
  you know a CP is globally non-foldable you've already folded it — there is nothing
  left to gate. So the architecture is necessarily: **local gate up front (dialog),
  global result shown after the attempt (red faces).** A locally-clean but
  globally-broken CP does **not** trigger the dialog — it folds and shows red faces.

## Oriedita reference (the parity oracle)

All under `third_party/oriedita/`.

**A — pre-check dialog** (`oriedita-ui/.../action/FoldAction.java:32-55`):

```java
if (!applicationModel.getFoldWarning()) {                 // false == "warn"
    Check4.apply(mainCreasePatternWorker.getFoldLineSet());
    if (!foldLineSet.getViolations().isEmpty()) {
        JCheckBox checkbox = new JCheckBox("Don't show this again");
        Object[] params = {"Detected errors in flat foldability. Continue to fold?", checkbox};
        int r = JOptionPane.showConfirmDialog(null, params, "Warning", JOptionPane.YES_NO_OPTION);
        if (r == JOptionPane.YES_OPTION || checkbox.isSelected()) {
            foldCreasePattern(...);                       // fold anyway
        }
        applicationModel.setFoldWarning(checkbox.isSelected());   // persist "don't show"
    } else {
        foldCreasePattern(...);
    }
} else {
    foldCreasePattern(...);                               // suppressed → fold directly
}
```

- The check: `origami/.../worker/foldlineset/Check4.java` — per-vertex parity,
  Maekawa (`|#M − #V| == 2`), Kawasaki (`angularlyFlatfoldable`), and big-little-big.
  Aggregated as `Queue<FlatFoldabilityViolation>` on `FoldLineSet`
  (`getViolations()`), each keyed by a **`Point`** (vertex), with a `Rule` and
  `Color`; `LittleBigLittleViolation` additionally carries the offending
  `LineSegment[]`.
- CP overlay: `CreasePattern_Worker_Impl.java:452-473` iterates violations →
  `DrawingUtil.drawViolation` (`DrawingUtil.java:533`) — triangle = parity,
  filled square = Maekawa, oval = angles, polylines for big-little-big.
- The "don't show again" pref is `ApplicationModel.foldWarning`
  (`oriedita-data/.../ApplicationModel.java:70`), persisted to `config.json`.

**B — estimation contradiction** (`origami/.../folding/algorithm/AdditionalEstimationAlgorithm.java`):

```java
private int tryInferAbove(int i, int j) throws InferenceFailureException {
    if (hierarchyList.get(i, j) == BELOW) throw new InferenceFailureException(i, j);  // i=upper, j=lower
    ...
}
```

`run(...)` **catches** `InferenceFailureException`, returns
`HierarchyListStatus.CONTRADICTED_2/3/4`, and records the offending faces in
`errorPos` (an `EquivalenceCondition` of faces a/b/c/d). The estimate is **not
aborted** — `FoldedFigure_Worker` stores `errorPos`, and
`FoldedFigure_Worker_Drawer.drawSelfIntersectingSubFaces` (`:129-143`) fills those
subfaces/faces red `(255,0,0,75)` on both the folded figure and the CP. No dialog;
`FoldingEstimateTask` only logs on a genuine interruption.

> **This is the crux difference.** Oriedita's `InferenceFailureException(i, j)` is
> exactly our `Contradiction { upper_face: i, lower_face: j }`, but ours propagates
> as a hard `Err` up through `folded_figure_fold_selected`, so nothing renders.

## Ori Studio current state (what we build on)

Paths relative to worktree root.

**Fold path (frontend → wasm):**
- Button/`F` → `handleFoldModel` (`apps/web/src/components/panels/CreasePatternPanel.tsx:1380`)
  → `foldOristudioCpDocument({ startingFaceId, lineIds })`.
- Store action `creasePatternSlice.ts:689-798` → `oristudioCpRuntime.ts:367` →
  worker `oristudioCpWorker.ts:178` → wasm `folded_figure_fold_selected`
  (`crates/oristudio-cp-wasm/src/lib.rs:376`) →
  `session.folding_estimated(order).map_err(to_js_folding_error)?`.

**Error types (Rust):**
- `FoldingEstimateError` (`crates/oristudio-cp/src/folding.rs:1025`) →
  `WorkerOverlap(WorkerOverlapSearchError)`
  (`crates/oristudio-cp/src/folding/permutation.rs:160`) →
  `AdditionalEstimation(AdditionalEstimationError)` with
  `Contradiction { upper_face, lower_face }` (`folding.rs:1051`).
- Stringified verbatim: `to_js_folding_error` does `format!("{error:?}")`
  (`oristudio-cp-wasm/src/lib.rs:695`) → envelope `{ code, message }` → toast.

**Error → toast:**
- `creasePatternSlice.ts:781` catch → `engineError(error)` → `set({ error })` →
  `GlobalToasts.tsx:15-37` fires `toast.error(t('toasts:global.error'), { description: formatUnknownError(error) })`.

**Flat-foldability checks exist AND are already displayed live (this is the key
correction — the violations are NOT missing):**
- `crates/oristudio-cp/src/checks.rs` — `check4`, `check_camv_task`,
  `find_flat_foldability_violation`, `angularly_flatfoldable`, `maekawa_color`,
  `FlatFoldabilityViolation`, `LittleBigLittleSegment`. Exposed as
  `OperationId::Check1..Check4` / `CheckCamv` (`crates/oristudio-cp/src/lib.rs`),
  emitting `CommandDiagnostic { point, segments, rule, violation_color,
  little_big_little }` (`lib.rs:209`).
- **There is already a live, always-on flat-foldability overlay** — the direct
  equivalent of Oriedita's `check4` display flag, and in fact *on by default* where
  Oriedita's is off:
  - `oristudioCpCamvResult` (store, `store/workspaceStore/types.ts:115`) holds the
    current CAMV diagnostics as a passive view of the document.
  - **Auto-recomputed on every mutating edit**, debounced off the critical path —
    `scheduleOristudioCamvRefresh` (`projectSlice.ts:1717-1736`), called after every
    mutating command (`:510`, `:1555`); seeded on load/build
    (`refreshAlwaysOnCamvDiagnostics`, `:206-221`).
  - Display toggle `camvIssuesVisible` (`lib/creasePatternViewport.ts:92`, default
    `true`; "CAMV issues" checkbox in `CpViewControlsPanel.tsx:68-70`).
  - Rendered in `CreasePatternPanel.tsx:1596-1624` via
    `buildCpDiagnosticMarkers` / `...Strokes` / `...Wedges`
    (`apps/web/src/cp-workspace/diagnostics/geometry.ts`), drawing the **per-rule
    glyphs already**: parity **triangle**, Maekawa **square**, angle **oval**,
    big-little-big **sector wedges** (`geometry.ts:134-181`).
  - Check1–Check4 are additionally available as one-shot menu commands
    (`menuDefinition.ts:231-235`) whose markers ride on `lastCommandResult` and clear
    on the next edit; the always-on CAMV overlay is the persistent path.
- **So Feature A does NOT add any highlighting** — the vertex glyphs are done. It only
  needs the pre-fold *gate*, the *dialog*, and the *preference*.

**Diagnostic-highlight pipeline handles points/segments/wedges — but NOT faces:**
- Structured markers → `OristudioCpDiagnosticEntry` (`apps/web/src/engine/oristudioCpTypes.ts:115`).
- **Gap for Feature B:** the overlay highlights **points/segments/wedges**; there is
  **no face-level red fill**, and nothing bridges the *fold* error (estimation
  contradiction) to any highlight.

**The two concrete gaps to close:**
1. **A:** No pre-fold flat-foldability *gate* → no "Continue to fold?" dialog → no
   "don't show again" preference. (The violation *display* already exists.)
2. **B:** Estimation `Contradiction` aborts hard (raw toast) instead of producing a
   partial folded figure with the offending **faces filled red**.

## Approach

Both features are in scope and required for full parity. A is small (the check +
display already exist; we add a gate, a dialog, and a preference). B is the deeper
Rust + new face-rendering change. Do A first (fast, unblocks the dialog UX), then B.
Each is broken into small, tool-verifiable phases (cargo/tsc/vitest) per
[[author-owns-phase-verification]].

---

## Feature A — Pre-fold flat-foldability warning dialog

The violation **display already exists** (live CAMV overlay + per-rule glyphs, on by
default — see background). Feature A adds only the missing pieces: a pre-fold *gate*,
the *dialog*, and a persisted *preference* (with a Preferences-panel toggle). It adds
**no** new highlight state and does **not** touch the overlay — pressing No or Yes
never changes what's highlighted; the CP overlay is driven purely by
`camvIssuesVisible`, exactly as Oriedita's is driven by its `check4` display flag
independent of the dialog.

### A1. Decide the "are there violations?" source

Oriedita's dialog runs `Check4.apply` and gates on `getViolations().isEmpty()`. We
have two options — pick the one that matches the on-screen overlay so the dialog and
the highlights never disagree:

- **Preferred: reuse the already-computed live result.** Read
  `oristudioCpCamvResult` (the same data the overlay shows). If it's non-empty when
  the user folds, warn. No new Rust, no extra worker round-trip, and the dialog is
  guaranteed consistent with what the user sees highlighted. Only caveat: confirm the
  live result is current at fold time (it's debounced; if a fold can fire before a
  pending refresh lands, force a synchronous recompute first — see A2).
- **Alternative: explicit synchronous check.** Add a wasm export
  `flat_foldability_check(handle) -> violations` and call it at fold time. More code,
  but zero staleness risk and lets us match Oriedita's `Check4` scope exactly if CAMV
  turns out to differ. Decide by confirming whether `check_camv_task` covers the same
  rules as `check4` (parity/Maekawa/Kawasaki/big-little-big).

Recommendation: start with the live `oristudioCpCamvResult`; fall back to the explicit
check only if staleness or scope mismatch shows up.

### A2. Gate the fold on violations + show the dialog

In the fold store action `foldOristudioCpDocument` (`creasePatternSlice.ts:689`) —
the single source of truth for both the Fold button and the `F` shortcut
(`CreasePatternPanel.tsx:1810`) — replicate `FoldAction`:

```
if (!foldWarningSuppressed) {
    const violations = getCurrentCamvViolations();     // A1: live result (or explicit check)
    if (violations.length > 0) {
        const { proceed, dontShowAgain } = await showFoldWarningDialog();
        if (dontShowAgain) setFoldWarningSuppressed(true);   // persist regardless of Yes/No (matches Oriedita)
        if (!proceed) return;                                // No → abort the fold; overlay untouched
    }
}
await foldRuntimeOristudioCpDocument(...);
```

Note Oriedita persists the checkbox whether the user clicks Yes or No
(`FoldAction.java:48` runs after either). If using the live result, ensure any pending
`scheduleOristudioCamvRefresh` has settled (or force a sync recompute) before reading,
so a just-edited CP can't fold without warning.

### A3. The dialog component + i18n

- Build the dialog from the repo's existing modal/confirm primitives (find the one
  already used for confirmations; do **not** hand-roll). Title "Warning", body
  "Detected errors in flat foldability. Continue to fold?", a "Don't show this again"
  checkbox, **No** / **Yes** buttons.
- New i18n keys per [[i18n-localization-architecture]] (inline English source):
  `dialogs:foldWarning.title` = "Warning",
  `dialogs:foldWarning.body` = "Detected errors in flat foldability. Continue to fold?",
  `dialogs:foldWarning.dontShowAgain` = "Don't show this again",
  plus `common:no` / `common:yes` if not already present. Run the `i18n:check` gate.

### A4. "Don't show again" preference (centralized storage)

- Add one key to the centralized storage module per [[web-storage-layer]]
  (`apps/web/src/lib/storage.ts`), e.g. `oristudio:fold-warning-suppressed`
  (boolean, default `false`). This is our `ApplicationModel.foldWarning`. Add a typed
  helper + register the key; do **not** hand-roll `localStorage`.

### A5. Preferences-panel toggle (in scope)

Oriedita exposes the same flag in `PreferenceDialog` ("Fold warning"). Add a matching
toggle so the user can re-enable the warning without clearing storage:

- Find the app's existing preferences/settings surface and add a "Warn before folding
  a non-flat-foldable CP" (or "Fold warning") toggle bound to the A4 storage key
  (inverted: checked = warn = `suppressed:false`).
- i18n key `preferences:foldWarning.label`. If no general preferences panel exists
  yet, the natural home is alongside the CP view controls
  (`CpViewControlsPanel.tsx`, which already hosts the "CAMV issues" toggle).

### A6. Verify Feature A

- `cd apps/web && npx tsc --noEmit` (per [[web-typecheck-regenerates-wasm]] — restore
  any spurious generated regen), `vitest` for the gate/preference logic; `cargo test
  -p oristudio-cp` only if A1's explicit-check alternative is taken.
- Browser checklist for Zach (author owns browser verification): fold a
  non-flat-foldable CP → dialog appears; **Yes** → folds (violations stay shown by the
  existing overlay); **No** → no fold (overlay unchanged); check "Don't show again" →
  fold → the pref persists and the Preferences toggle reflects it; reload → folding a
  bad CP no longer prompts; flip the Preferences toggle back on → prompt returns.

---

## Feature B — Graceful estimation contradiction (no more raw toast)

Goal: when `folding_estimated` hits `Contradiction { upper_face, lower_face }`, don't
abort — produce the partial folded figure and highlight the contradicting faces red
on both the folded figure and the CP, matching `drawSelfIntersectingSubFaces`.

### B1. Rust: turn the contradiction from `Err` into a carried diagnostic

This is the core change and mirrors Oriedita catching `InferenceFailureException` in
`AdditionalEstimationAlgorithm.run` and stashing `errorPos`.

- In the additional-estimation path (`folding.rs` `run_additional_estimation` /
  `additional_estimation_from_segments`, and the `possible_overlapping_search` call
  in `run_folding_estimated_05`, `folding.rs:1514`), **catch**
  `AdditionalEstimationError::Contradiction { upper_face, lower_face }` instead of
  propagating it. Record it on the estimate, e.g.
  `FoldingEstimate.contradiction: Option<FoldContradiction>` where
  `FoldContradiction { upper_face, lower_face, /* + the subface/face ids to fill */ }`.
- Study exactly which faces Oriedita fills: `errorPos` is an `EquivalenceCondition`
  of **four** faces (a/b/c/d) plus the subface, not just the upper/lower pair — so
  `Contradiction` may need to carry the surrounding equivalence-condition faces to
  reproduce the red-fill footprint. Confirm against
  `FoldedFigure_Worker_Drawer.drawSelfIntersectingSubFaces` and
  `FoldedFigure_Configurator` (`origami/.../worker/FoldedFigure_Configurator.java`).
- The estimate should still return the best partial layering it reached (Oriedita
  keeps the `HierarchyList` state), so `folded_figure_render_snapshot` yields
  geometry to draw. Decide the fallback ordering when no valid stack exists (Oriedita
  still renders the transparent/step-3 development in that case — see the Step5→Step3
  fallback already present at `folding.rs:1483-1487`).
- Keep a **hard-error path** for the genuinely unrecoverable cases
  (`InitialHierarchy(SameParityAdjacentFaces)`, `SubFace` search failures) — those
  are structural and Oriedita also can't fold them. Only `Contradiction` becomes a
  carried diagnostic.
- Verify: `cargo test -p oristudio-cp` — add a capture of a known contradicting CP
  (the `upper_face: 15, lower_face: 12` case is a perfect fixture if reproducible),
  assert `folding_estimated` now returns `Ok` with `contradiction: Some(...)` and a
  non-empty render snapshot.

### B2. wasm + TS types: expose the contradiction on the fold result

- Extend the fold-result envelope (`folded_figure_fold[_selected]`,
  `crates/oristudio-cp-wasm/src/lib.rs:353-404`) to include the optional
  `contradiction` (faces + fill footprint). Update
  `OristudioCpFoldedFigureResult` / snapshot types in
  `apps/web/src/engine/oristudioCpTypes.ts`.
- `to_js_folding_error` stays for the *structural* hard errors only.

### B3. Frontend: stop toasting, start highlighting

- In `foldOristudioCpDocument` (`creasePatternSlice.ts:748`), when the result carries
  a `contradiction`, treat it as **success-with-warning**: store the folded figure
  normally (`status: 'ready'`, not `'error'`), and stash the contradiction faces
  **on the folded-figure entry itself** (not in a document-global field). This is the
  natural place because the red faces belong to *that* fold.
- **Clear-on-delete (required):** because the contradiction lives on the folded-figure
  entry, deleting that figure (`deleteOristudioCpFoldedFigure`) removes the red-face
  highlight for free — no separate cleanup path, and no stale highlight left behind
  when the offending fold is gone. Confirm the render layer reads the highlight from
  the entry so deletion is sufficient. (Re-folding replaces the entry, likewise
  clearing/refreshing it.)
- Do **not** route it through `set({ error })` (which triggers `GlobalToasts`).
  Optionally show a non-blocking inline note / bulletin-style text
  (Oriedita's `text_result`), not a red error toast.
- The structural hard errors (still `Err`) keep the toast — but humanized, not the raw
  Debug string (B5).

### B4. Render the red face highlight (new capability — folded figure + CP)

This is genuinely new: today's overlay highlights **points/segments**, not **faces**.

- **Folded figure:** the fold→scene adapter
  (`apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts`, per
  [[folded-form-context-menu]]) builds earcut fills per face. Add a red translucent
  fill `(255,0,0,~0.3)` for the contradiction faces, matching Oriedita's
  `(255,0,0,75)`.
- **Flat CP:** add a face-fill overlay in `CreasePatternPanel.tsx` for the same face
  ids (Oriedita fills both). Requires mapping face id → CP polygon; the subface/face
  geometry already exists in the estimation snapshot — expose the CP-space polygon for
  each contradiction face id from Rust (cheapest: include the face polygons in the
  contradiction payload rather than re-deriving on the client).
- Gate it like Oriedita's `displaySsi` flag if desired, or always-on for the
  contradicting figure.

### B5. Humanize residual hard errors (in scope)

Even with B done, the remaining structural `FoldingEstimateError`s still stringify as
Debug. Map them to friendly messages in the worker/store boundary
(`normalizeError` in `oristudioCpWorker.ts:64` or `engineError`), e.g.
`InitialHierarchy(SameParityAdjacentFaces{..})` → "This crease pattern can't be
folded flat: two faces meet with the same orientation across a crease." Keep the raw
Debug string available in a details/expand affordance for debugging. Cover every
`FoldingEstimateError` / `WorkerOverlapSearchError` variant with an i18n'd message.

### B6. Verify Feature B

- `cargo test -p oristudio-cp` (contradiction fixture returns `Ok` + faces),
  `cd apps/web && npx tsc --noEmit`, `vitest`.
- Browser checklist: fold the CP that produced
  `Contradiction { upper_face: 15, lower_face: 12 }` → **no error toast**; a folded
  figure renders with faces 15/12 (+ neighbors) filled red on both the folded figure
  and the CP; the fold still completes.

---

## Sequencing (both features are required)

Both A and B ship — full parity is the goal. Order:

1. **Feature A** — small (gate + dialog + preference; display already exists). Lands
   the visible dialog UX fast and is low-risk.
2. **B5** — humanize hard errors. Independent, immediate win, helps even before B1.
3. **Feature B (B1–B4, B6)** — the estimation refactor (B1) is the real work; the red
   face-fill (B4) is new rendering. This is what actually kills the user's toast:
   Feature A alone doesn't, because after "Yes" the same contradiction (a B error)
   still fires.

## Out of scope

- Native macOS menu wiring (per [[i18n-localization-architecture]] the Tauri native
  menu is handled separately; this is a frontend dialog).
- Changing the estimation *algorithm* to fold more CPs successfully — parity here is
  about **surfacing** contradictions gracefully, not eliminating them.

## Open questions to resolve during implementation

1. **A1 source: RESOLVED — use the live `oristudioCpCamvResult`.** `check_camv_task`
   is literally `check4` (`checks.rs:232-237` — `violations: check4(model)`), so the
   always-on CAMV overlay *is* the Oriedita `Check4` violation set; no scope mismatch,
   and the dialog stays consistent with the on-screen highlights by construction. Only
   remaining work: a sync-refresh guard so a just-edited CP can't fold on a debounced-
   stale result (flush/await any pending `scheduleOristudioCamvRefresh`, or force one
   sync recompute, before reading at fold time).
2. **B1 face footprint:** does reproducing Oriedita's red fill need the full
   `EquivalenceCondition` (4 faces + subface), or is the `upper_face`/`lower_face`
   pair enough visually? Read `drawSelfIntersectingSubFaces` + `errorPos` usage
   before finalizing the `FoldContradiction` shape.
3. **A vs B interaction:** keep them independent (Oriedita does) — "Yes" on the A
   dialog does not pre-empt a B contradiction; a Yes can still lead to red faces.

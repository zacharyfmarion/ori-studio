# Failed Load Error Surfacing

## Goal

When a crease pattern fails to open, say so. Today the app builds a correct
read-only fallback with the kernel's reason attached, and then destroys it
milliseconds later — replacing it with a blank document, clearing the error, and
leaving the window titled with the user's filename.

The user sees an empty sheet named after their file and no indication that
anything went wrong. Reproduced against `main` as of this branch's merge.

## Reproduction

Subscribing to the store across one `loadCreasePatternText` of a `.fold` the
kernel rejects:

| # | status | cp doc | `oristudioCpError` | read-only import | panel |
| --- | --- | --- | --- | --- | --- |
| 1 | `loading_engine` | — | — | — | crease-pattern |
| 2 | `crease_pattern_ready` | none | `"invalid Oriedita field vertices_coords: edge references miss…"` | **yes** | design |
| 3 | `crease_pattern_ready` | **blank, 4 segs** | **null** | **no** | crease-pattern |

Row 2 is the intended fallback. Row 3 is the auto-provisioner overwriting it.

Resulting state:

```
windowTitle:     "MyDesign - Ori Studio"
currentFileName: "MyDesign.fold"
currentFilePath: "/Users/me/MyDesign.fold"
oristudioCpDocument.document.title: "Untitled CP"   // blank starter
oristudioCpError: null
```

The only record is `console.error("[cp-load] … loaded read-only: the editable
kernel refused it")`.

**Not** a save-overwrite: `nativeSaveTarget()` gates on
`isNativeProjectFilename`, so File > Save on a `.fold` forces Save-As to `.osf`.
Verified, and the `.ori`/`.orh` failure path is clean too (it rethrows, status
stays `error`, `currentFilePath` is left on the previous document). The damage is
silent non-loading and a misleading UI, not file destruction.

## Approach

### 1. Teach the auto-provisioner what failure looks like

`apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:939` seeds a
blank CP whenever the Edit workspace has no document. Its guard asks only
whether a document exists:

```ts
if (get().oristudioCpDocument) { /* …share handling… */ }
```

It never asks *why* there isn't one. After a failed load there isn't one, so it
provisions — and `freshEditableCpState` -> `discardCpDocumentState`
(`cpDocumentState.ts:73,77`) explicitly nulls both `importedCreasePattern` and
`oristudioCpError` on the way through.

Add the missing condition: do not auto-seed when the absence of a document is a
*result* rather than a starting state — i.e. when `oristudioCpError` is set or a
read-only `importedCreasePattern` is present.

Prefer making that explicit over inferring it. A `cpProvisioningState` of
`'empty' | 'failed' | 'read-only'` (or equivalent) read by the guard is clearer
than stacking two negative checks, and it stops the next person re-introducing
this by adding a third failure mode the guard doesn't know about. This is the
same lesson as `implementation-plans/web-startup-provisioning-architecture.md`:
provisioning is a decision about intent, and "no document" is not intent.

### 2. Surface the reason in the UI

`oristudioCpError` currently has no user-visible presentation on this path. Once
the guard stops clearing it, render it — the failed-open state should name the
file, give the kernel's reason, and offer the obvious next actions (open a
different file / start a blank CP). The read-only import that already survives in
row 2 is a real fallback worth offering explicitly rather than discarding.

Also promote the importer's accumulated `diagnostics.warnings` (e.g. "Some FOLD
edges were ignored…") into that surface. They exist today and nothing reads
them, which is what lets a *partially* corrupted import look clean — see
`implementation-plans/fold-import-integrity.md`, which depends on this being
visible to be observable at all.

### 3. Stop presenting a blank document as the user's file

When provisioning is genuinely correct (a real blank canvas), the document is
`Untitled CP` — but `currentFileName` / `currentFilePath` / the window title
still point at the file that failed. Clear the file association whenever the
document being shown is not the file, so the title bar cannot claim otherwise.

## Affected Areas

- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` —
  `ensureEditCreasePattern` guard
- `apps/web/src/store/workspaceStore/cpDocumentState.ts` — `discardCpDocumentState`
  clearing error/import state
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` —
  `loadCreasePattern`, and the file-association fields
- `apps/web/src/components/panels/CreasePatternPanel.tsx` (or a new failed-open
  surface) — presentation
- `apps/web/src/store/workspaceStore/freshCreasePattern.ts` — if the state shape
  gains a provisioning reason

## Checklist

- [x] Add a store test asserting the row-2 -> row-3 transition does **not** occur
      (written first, confirmed red for the right reason: the pre-provision
      assertions passed, then `oristudioCpError` was `null`)
- [x] Introduce an explicit provisioning reason rather than a second negative check
      — `cpLoadFailure` on the store, deliberately separate from `oristudioCpError`
- [x] Guard `ensureEditCreasePattern` against failed / read-only states
- [x] Keep `oristudioCpError` and `importedCreasePattern` alive through provisioning
- [x] Render a failed-open surface: filename, kernel reason, recovery actions
      — the surface already existed at `CreasePatternPanel.tsx:3086`; it was
      unreachable, and once reached it needed the CSS fix below
- [x] Regression test: a refused load must still allow File > New to seed again
      (guards against trading a silent blank canvas for a dead end)
- [x] Regression test: a stale *command* error must not block provisioning
      (guards the choice of discriminator)
- [x] Verify the share-link path (`pendingSharedCp`) still provisions correctly —
      the guard exempts a pending share; `sharedCpProvisioning.test.ts` passes
- [x] Validate: web lint/typecheck/test — 236 files, 2370 tests, eslint clean
- [x] Automated coverage for the CSS collapse — **decided: not pursued**
      (option 3 below; browser-verified only, invariant recorded in the rule)
- [ ] Surface importer `diagnostics.warnings` for partially-dropped imports
      (deferred — lands with `fold-import-integrity.md`, which creates the
      partial-drop cases this would report)
- [ ] Open draft PR against `main`

## Resolved by analysis, not code

The plan's third item — clear `currentFileName` / `currentFilePath` / the window
title — turned out to be **unnecessary once the guard landed**. It was only wrong
because a *blank* document was being shown under the user's filename. With the
self-provision suppressed, the read-only import stays on screen, so the file
genuinely is open and the title bar is honest. Changing it now would be a
regression.

## Test infrastructure gap

Fixing the guard exposed a second, adjacent defect: the read-only surface
rendered as a **40x40 box of pure padding**, so the message was in the DOM but
invisible.

Cause: `.cp-panel__body` uses `place-items: center` and only stretches its items
under the `--with-tools` modifier, which is absent when there is no editable
document. In that state nothing inside `.cp-panel__viewport` is in flow — the
canvas is unmounted and the overlay, toolbar and status readout are all
absolutely positioned — so the grid track collapsed to 0x0 and `inset: 0` plus
`padding: var(--space-5)` produced exactly 40x40.

Fix: `align-self: stretch; justify-self: stretch` on `.cp-panel__viewport`.

**This one has no failing-test-first coverage, and cannot have it today.** The
web suite runs under `jsdom`, which has no layout engine: `getBoundingClientRect`
returns zeros regardless of CSS, so "the viewport collapses to 0x0" cannot be
made to fail and then pass. `playwright` is a devDependency but is only used by
standalone `scripts/*.mjs` tooling; nothing wires a browser-mode harness into
`npm run test:web` or CI.

Verified instead by direct browser measurement, before and after:

| | `.cp-panel__viewport` | `.cp-panel__unopened` |
| --- | --- | --- |
| before | 0 x 0 | 40 x 40 |
| after | 1130 x 864 | 1130 x 864 |

Options considered:

1. Add a Vitest browser-mode project (Playwright provider) for a small set of
   layout assertions. Real coverage; new CI surface and runtime.
2. Extend the existing `scripts/folded-grid-screenshot.mjs` pattern into a
   checked-in visual/layout smoke run. Reuses tooling already present.
3. Accept browser-verified-only for CSS, and keep the rule commented so the
   invariant is at least written down. Cheapest, no gate.

**Decision (2026-08-05): option 3.** A single `align-self` rule does not justify
standing up a browser-mode CI surface, and options 1 and 2 are better judged on
their own merits than as a rider to this fix. The consequence is explicit: no
automated test would catch this collapsing again. If layout regressions start
recurring, option 1 is the real answer and should be scoped separately.

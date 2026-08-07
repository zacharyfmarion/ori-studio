# Landing owns the active panel

## Goal

Give `activePanelId` **one writer on the open path**, so opening a file can never
leave `activeEditingContext` disagreeing with the workspace on screen.

Reported symptom: after opening an `.osf` that carries both a box-pleat design
and a crease pattern *while the Edit workspace is already active*, every keyboard
shortcut in Edit goes dead and the toolbar renders the BP verbs (Optimize / Send
to Edit) over the crease-pattern canvas. Switching to Design and back heals it.

## Root cause

Measured in the browser against `iguana_30.osf`:

| | `activePanelId` | `activeEditingContext` | `q` claimed? |
|---|---|---|---|
| before open (in Edit) | `cp-view-controls` | `crease-pattern` | yes |
| after the open | `design` | `bp-tree` | **no** |
| after Design → Edit | `cp-view-controls` | `crease-pattern` | yes |

The chain:

1. `installLoadedDesignTabs` writes `activePanelId: 'design'` **speculatively** —
   a guess that opening a file lands on the design pane.
2. `applyLandingWorkspace` then computes the real landing. The file carries a
   crease pattern, so `landingWorkspace` correctly returns `'edit'` and calls
   `activateWorkspace('edit')`.
3. `activateWorkspace` hits `if (workspace === activeWorkspace) return` — Edit was
   already active — so the dock is never touched.
4. Dockview's active panel therefore never changes, and `onDidActivePanelChange`
   is **edge-triggered**: no change, no event, no correction. Nothing in the
   codebase re-reads the dock's current panel.
5. `activePanelId` stays `'design'`, the derivation subscriber in `store.ts`
   computes `bp-tree`, and every consumer keyed on the context is wrong.
   `shortcutScopeStackForContext` never pushes the `crease-pattern` scope, so no
   CP chord even matches a definition.

`File > New` escapes this because it calls `activateWorkspace('design')` from
Edit — a genuine switch, so the dock rebuilds and re-fires. A plain `.cp` escapes
it because its speculative write (`'crease-pattern'`) happens to be right. The
bug needs all three of: a loader that guesses `'design'`, a landing of `'edit'`,
and Edit already active.

### The architectural fault

`activePanelId` is a cache of state Dockview owns, with **three writers and no
way to re-read the truth**: the workspace dock's change event, the design-tab
dock's change event, and five speculative writes in the loaders. Both event
sources report *changes, not state*, so a write from the third source can never
be corrected by the first two.

The third writer exists only for test convenience — `projectSlice.ts` says so
outright ("never fires in headless tests"). A test-environment gap was patched
with production state.

`applyLandingWorkspace`'s own comment describes this exact bug already fixed one
level up ("without this the landing was whichever loader happened to run last").
The *workspace* decision was centralized; the *panel* decision was not. This
change finishes that job.

## Approach

1. **Wire up `WorkspaceDefinition.primaryPanelId`.** It is already declared for
   all three workspaces and read by nothing — the modelling for "each workspace
   has a canonical pane" exists, it was just never connected.
2. **Make the landing authoritative.** `applyLandingWorkspace` sets
   `activePanelId` after activating the workspace, asking the dock first and
   falling back to `primaryPanelId` when there is no dock (headless).
3. **Delete the speculative writes** in `projectSlice` and `freshCreasePattern`.
   The headless fallback removes their justification.
4. **Reconcile in `activateWorkspace`'s no-op path** so the invariant holds for
   its other callers too, not just the open path.

Out of scope, flagged for follow-up: the workspace dock and the design-tab dock
both write `activePanelId` and race (`design-workspace` then `design`), and
`design-workspace` is in neither `STATIC_PANEL_CONTEXTS` nor
`WORKSPACE_BY_PANEL_ID` — it survives on the `primaryContext(kind)` fallback.
Separable from this fix.

## Affected Areas

- `apps/web/src/workspaces/workspaces.ts` — expose `primaryPanelIdFor`
- `apps/web/src/store/layoutStore.ts` — reconcile on the no-op switch
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — authoritative
  landing; drop 4 speculative writes
- `apps/web/src/store/workspaceStore/freshCreasePattern.ts` — drop the 5th
- Tests: `store.test.ts`, `layoutStore.test.ts`, `appKeyboard.test.ts`

## Checklist

- [x] Test A — store: an `.osf` landing in an already-active Edit keeps
      `activeEditingContext === 'crease-pattern'` (uses the *real*
      `activateWorkspace`, not the `vi.fn()` stub every open-path test uses today)
- [x] Test B — keyboard: after that open, a CP tool chord is claimed
- [x] Test C — layoutStore: a no-op `activateWorkspace` still reconciles
      `activePanelId` with the dock
- [x] Test D — invariant across every open path:
      `workspaceForPanelId(activePanelId) === activeWorkspace`
- [x] Confirm A–D fail before the fix — each failed for its own reason, matching
      what the browser showed:
      - A: `expected 'design' to be 'crease-pattern'`
      - B: `expected false to be true` — the chord was not even claimed
      - C: `expected [] to deeply equal [ 'cp-view-controls' ]`
      - D: `bp-with-cp.osf left design active: expected 'design' to be 'edit'`
- [x] Implement steps 1–4
- [x] Confirm A–D pass, and the rest of the web suite still does (263 files,
      2729 tests)
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [x] Verify in the browser against the reported file: opening it while Edit is
      already on screen now leaves `crease-pattern` active, `Q`/`E` drive the
      tool rail, and the menu bar reads "Crease Pattern" rather than "Design"
- [ ] Draft PR against `main`

## Notes

`activateWorkspace` reconciles on **every** exit rather than at its call sites:
navigating is what decides the pane, so no caller has to remember. That also
covers `activatePanel`, `startNewDesign`, `addDesignTab`, and the design-method
creators, which had the same latent hazard.

Removing `activePanelId` from `freshEditableCpState` fixes a latent inverse of
the same bug: `ensureEditCreasePattern` self-provisions a blank canvas in the
background, and it was dragging the active pane to `crease-pattern` even when the
user was looking at Design.

Three `activateWorkspace` spies in `store.test.ts` became **delegating** spies
(`vi.fn(useLayoutStore.getState().activateWorkspace)`). Stubbing the navigation
verb outright is what let this bug through in the first place — the assertion
they exist for still holds, but the real reconcile now runs underneath.

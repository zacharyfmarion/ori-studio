# CP camera: an imperative handle instead of a command prop

## Goal

Make every camera move in the crease-pattern viewport a direct call from the
handler that caused it, so no camera move can be triggered by a re-render.

Today a camera move is modelled as state: the panel writes a `CameraCommand`
object, React passes it down, and an effect in the canvas applies it. Because
React de-duplicates identical state, that object carries a `nonce` whose only job
is to make the effect fire again for a repeated action. A nonce is the tell — if
you need one, the thing was never state.

The cost is not theoretical. The bug fixed in #166 was exactly this failure: the
diagnostic camera followed a `bounds` object derived from the selected entry, and
an effect keyed on that object's identity treated a re-derivation as a fresh
instruction. Hiding and re-showing the CAMV overlay rebuilt the bounds and threw
the user back to an issue they had deliberately zoomed away from. That fix routes
framing through a one-shot store request consumed by a hook — correct, but it
adds a second effect to a chain that should have none:

```
HUD row click
  └─ store action (raises focus request)             ← state
      └─ panel effect (useCpDiagnosticFocus)         ← effect
          └─ setWebglCameraCommand({…, nonce})       ← state
              └─ prop to canvas
                  └─ canvas effect on [cameraCommand] ← effect
                      └─ cameraRef.current = …; render
```

After this change:

```
HUD row click
  └─ camera.current.frameModelBounds(bounds)
```

### What stays an effect, and why

This is not "remove the effects." An effect is the right tool for keeping the view
in sync with state; it is the wrong tool for performing an action. The line is
whether re-running it on identical inputs is harmless.

The canvas writes `cameraRef.current` in six places. Only two of them are the
problem:

| Site | What it is | Fate |
| --- | --- | --- |
| `framingKey` effect (1246) | new document ⇒ re-fit | **stays** — sync, and a no-op for the same document |
| `ensureCamera` seed-by-fit (1325) | lazy first-frame seed, inside the render path | untouched |
| context-loss recovery (1319) | adopt the dead renderer's camera | untouched |
| mount-effect teardown (2805) | drop the camera with the renderer | untouched |
| command effect — `fit` (2908) | an action | **moves to the handle** |
| command effect — `focus-bounds` (2948) + in-place `cam` mutations | actions | **move to the handle** |

Re-running "zoom in" is not a no-op, so it never belonged in an effect. Re-fitting
for the document you are already on is, so it can stay in one.

Note the seed is lazy: before the first draw `cameraRef.current` is null and every
verb is a no-op. That matches today — the command effect has the same `!cam`
guard — so `fit` on a just-opened document before the first frame does nothing in
both worlds.

## Approach

### Phase 1 — Give the camera verbs a testable home

`cp-workspace/renderer/camera.ts` already holds the primitives (`fitUserCamera`,
`zoomUserCameraAt`, `normalizeCameraRotation`) and already has `camera.test.ts`.
What lives *inline* in the canvas effect today is the verb-level policy, and it is
untested — including the framing rule that the #166 bug ran through.

Move that policy into `camera.ts` as pure functions over `(camera, viewport, …)`:

- `frameUserCameraOnBounds(userBounds, viewport, camera, docBounds)` — the
  diagnostic framing rule: 0.5 padding, preserve the current rotation, never zoom
  *out*, never exceed 4× the document fit.
- `cameraZoomForPercent(percent, deviceRatio)` — the `set-percent` math
  (100% ≡ one user unit per CSS px).

`zoom-in` / `zoom-out` / `rotate-*` are one-liners over existing helpers and do not
need new functions.

Add unit tests for both. This is where the real test value lands: after Phase 3 the
#166 regression is prevented *structurally* (no reactive path from
`camvIssuesVisible` to the camera exists), so an equivalent behavioural test would
assert against a path that no longer exists. The rule itself is what stays worth
pinning down.

### Phase 2 — Expose `CpCameraHandle`; delete the command rail

React is on 19.2, so `ref` is a plain prop — no `forwardRef` needed.

```ts
export interface CpCameraHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  setZoomPercent(percent: number): void;
  rotateBy(radians: number): void;
  rotateTo(radians: number): void;
  rotateReset(): void;
  frameModelBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void;
}
```

Every verb shares the same guard the effect has today (canvas mounted, camera
seeded, non-zero width), so it goes in one private helper and each verb becomes
one or two lines:

```ts
const withCamera = (fn: (cam: Camera, viewport: Viewport, canvas: HTMLCanvasElement) => void) => {
  const canvas = canvasRef.current;
  const cam = cameraRef.current;
  if (!canvas || !cam || canvas.width === 0) return;
  fn(cam, { width: canvas.width, height: canvas.height, dpr: 1 }, canvas);
  renderNowRef.current();
};
```

`useImperativeHandle` runs at commit like a layout effect, but it is not reactive —
it never fires on a data change. It only publishes methods; the camera moves when
one is called.

Delete in the same commit (they are one unit — removing the prop breaks the panel
until the call sites move): `CameraCommand`, its `nonce`, `modelBounds`, the
`cameraCommand` prop, the ~50-line effect, the `webglCameraCommand` state,
`cameraCommandNonceRef`, `sendWebglCameraCommand`, `focusWebglCameraOnModelBounds`.

Switch all 13 call sites — every one is already an event handler:

| Call site | Count | Becomes |
| --- | --- | --- |
| `handleCpShortcutAction` — `viewport.zoomIn/zoomOut/fit/rotateCcw/rotateCw/resetRotation/actualSize` | 7 | `cpCamera()?.zoomIn()` etc. |
| `ViewportToolbar` — `zoomIn`, `zoomOut`, `fitToView`, `rotateView`, `setViewRotation` | 5 | direct calls |
| `setZoomLevel` (zoom-preset dropdown) | 1 | `cpCamera()?.setZoomPercent(scale * 100)` |

The handle is null while no editable CP is open (the canvas is conditionally
rendered), so call sites optional-chain. That matches today: those commands were
already no-ops when the effect's guard failed.

Side benefit: the panel currently re-renders on every zoom click purely to pass a
new prop down. It stops doing that. The canvas → panel readouts
(`onZoomPercentChange`, `onRotationChange`) are unaffected — they are the other
direction and stay callbacks.

### Phase 3 — One framing rule, at the only chokepoint there is

A check command has **three** dispatch paths, and only one of them runs through the
panel:

| Trigger | Path |
| --- | --- |
| Tool rail / keyboard | `handleCpToolAction` → `executeOristudioCpCommand` |
| **Menu** (`cp.checkCamv`, `cp.check1…4`) | `CP_OPERATION_ACTIONS` → `menuActions.ts:380` → `executeOristudioCpCommand` — **never touches the panel** |
| CP-detect import | `CpDetectImportModal.tsx:217` loops `Fix1, Fix2, Check1…4, FlatFoldableCheck` |

So framing at `handleCpToolAction` would cover the rail and silently drop the menu
— the most common way to run a check. The store action is the only common point.

Put the rule where the diagnostic actually becomes active, and let it reach the
camera through a module registry, the same shape the keyboard system already uses
(`registerCpActionShortcutExecutor`, where the panel registers an imperative
executor that non-React code calls) and the same seam as `cpOverlayViewStore`:

```ts
// cp-workspace/renderer/cpCameraRegistry.ts
export function registerCpCamera(handle: CpCameraHandle | null): void;
export function cpCamera(): CpCameraHandle | null;
```

The canvas registers on mount and clears on unmount. Then **one** rule covers all
three paths and both triggers:

> Activating a diagnostic frames it — unless it is hidden.

Applied in the store's activation path (`setOristudioCpActiveDiagnostic` and the
command-result branch in `projectSlice`), which already share
`activateCpDiagnostic`. The visibility check is a store read too
(`oristudioCpViewport.camvIssuesVisible`), so the rule that #166 expressed as
"drop a request whose entry is not listed" survives intact.

This is not an effect driving an action: `executeOristudioCpCommand` is called by
a user gesture, it awaits, it frames. Direct causal chain, no re-render can enter
it. The panel stops being involved in diagnostic framing at all — the HUD click
already calls `setOristudioCpActiveDiagnostic`, so it gets framing for free.

Delete: `cp-workspace/diagnostics/useCpDiagnosticFocus.ts` and its test,
`oristudioCpDiagnosticFocusRequest`, `clearOristudioCpDiagnosticFocusRequest`, and
the focus-request assertions in `store.test.ts`. `cpDiagnosticFocus.ts` stays but
gains the framing call; keep the store's auto-select of `diagnosticEntries[0]`.

**Known wart this exposes, not caused by it:** the CP-detect import loop runs seven
commands, and each non-mutating check adopts its own first entry — so the camera
hops per check and lands wherever `FlatFoldableCheck` finished. That is today's
behaviour on both the old code and #166. Worth deciding separately whether a batch
import should frame at all; do not silently change it here.

### Out of scope

The menu → panel hop for CP actions (`requestOristudioCpAction` → the store request
consumed by the effect at `CreasePatternPanel.tsx:1679`) is the same pattern and is
the channel for *every* CP menu action, not just diagnostics. Worth its own look
later; changing it here would make this diff about something else.

## Affected Areas

- `apps/web/src/cp-workspace/renderer/camera.ts` + `camera.test.ts` — verb policy
  moves here, with tests.
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — gains
  `CpCameraHandle` + `useImperativeHandle` + registry registration; loses the
  `cameraCommand` prop, its effect, and the `CameraCommand` type.
- `apps/web/src/cp-workspace/renderer/cpCameraRegistry.ts` — new; the module seam
  that lets non-React callers reach the camera.
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — loses the command
  state, nonce ref, both senders, and the diagnostic-focus hook call; 13 call
  sites become direct calls. It stops participating in diagnostic framing.
- `apps/web/src/store/workspaceStore/` — `cpDiagnosticFocus.ts` gains the framing
  call; the focus request drops out of `types.ts`,
  `slices/creasePatternSlice.ts`, `slices/projectSlice.ts`, `store.test.ts`.
- `apps/web/src/cp-workspace/diagnostics/useCpDiagnosticFocus.ts` + test — deleted.

No engine, wasm, or Rust surface. No user-facing strings, so no i18n work.

## Sequencing

Stack this on the existing `claude/foldability-zoom-reset-bug-acf23b` branch rather
than opening a second PR against `main`. #166 is an unmerged draft, so nothing has
shipped yet, and stacking means the merged end state contains no transitional
machinery — which is the point. The history still reads as three coherent
arguments: fix the bug and explain the root cause, make the camera imperative,
then collapse the focus request into a direct call.

The alternative — merge #166 and refactor after — ships the store request and hook
for one release and then deletes them.

## Checklist

- [ ] Phase 1: `frameUserCameraOnBounds` + `cameraZoomForPercent` in `camera.ts`
- [ ] Phase 1: unit tests — never zooms out, caps at 4× document fit, preserves rotation, percent↔zoom round-trip
- [ ] Phase 2: `CpCameraHandle` + `withCamera` guard + `useImperativeHandle` in the canvas
- [ ] Phase 2: `cpCameraRegistry.ts`; canvas registers on mount, clears on unmount
- [ ] Phase 2: canvas command effect, `CameraCommand`, nonce, and `cameraCommand` prop deleted
- [ ] Phase 2: all 13 panel call sites switched to direct calls
- [ ] Phase 3: framing moves into the store's diagnostic-activation path, gated on `camvIssuesVisible`
- [ ] Phase 3: focus request and `useCpDiagnosticFocus` removed; `store.test.ts` assertions updated
- [ ] Phase 3: store test proving all three dispatch paths frame — rail, menu (`menuActions`), and a direct `executeOristudioCpCommand('CheckCamv')`
- [ ] `npx tsc --noEmit`, `npm run lint:web`, web unit tests
- [ ] Browser pass (owner): zoom in/out/fit/actual-size, rotate cw/ccw/reset, zoom-preset dropdown, keyboard chords for each
- [ ] Browser pass (owner): click an issue → zoom out → toggle Foldability issues off/on (camera holds); click the same row again (re-frames)
- [ ] Browser pass (owner): run Check foldability **from the menu** and **from the tool rail** — both frame the first issue

# Simulator Keyboard Controls

## Goal

Give the origami simulator intuitive keyboard controls so the fold can be
played, scrubbed, and reset — and the view reset — without reaching for the
mouse. Space plays/pauses; the arrow keys scrub the fold timeline. Controls must
never fire while the user is typing in a field or driving a different workspace,
and every binding must map to an existing panel action (no new engine behavior).

## Keymap

Decided with the user; ↑/↓ intentionally left unbound for now.

### Timeline / playback

| Key | Action | Existing handler |
| --- | --- | --- |
| `Space` | Play / pause the fold | `setPlaying(!playing)` |
| `→` | Scrub fold forward one step | new `nudgeFold(+foldStepPercent)` over `setFoldTarget` |
| `←` | Scrub fold backward one step | new `nudgeFold(-foldStepPercent)` over `setFoldTarget` |
| `Shift`+`→` | Jump to fully folded (100%) | `setFoldTarget(100)` |
| `Shift`+`←` | Jump to flat (0%) | `setFoldTarget(0)` |
| `R` | Reset fold to flat (replay) | `replayFromFlat` |
| `↑` / `↓` | — (reserved, unbound) | — |

### View

| Key | Action | Existing handler |
| --- | --- | --- |
| `0` / `Home` | Reset camera to default view | `resetView` |
| `+` / `=` | Zoom in | mirror `handleCanvasWheel` (`viewRef.current.zoom` → `pushView()`) |
| `-` / `_` | Zoom out | same |

### View toggles (second tier — include if we want the full set)

| Key | Action | Existing handler |
| --- | --- | --- |
| `F` | Toggle faces | `setViewSettings(s => ({...s, showFaces: !s.showFaces}))` |
| `C` | Toggle crease lines | `showEdges` |
| `H` | Toggle hidden lines (only when creases on) | `showHiddenLines` |
| `L` | Toggle lighting | `lighting` |

Notes:
- `→`/`←` scrub by `runConfig.foldStepPercent` (the same step the Step button
  uses), clamped 0–100. Scrubbing sets `playing` false first (matches
  `setFoldTarget`, which already pauses), so a manual scrub stops playback.
- Key auto-repeat is desirable here: holding `→` scrubs continuously.

## Approach

### Handler location & scoping

Add one `useEffect` in `SimulatorPanel.tsx` that registers a `window`
`keydown` listener, following the existing pattern in
`CreasePatternPanel.tsx:1956`. The panel only mounts in the Simulate
workspace, so a window listener is already scoped to when the simulator is on
screen — no global workspace check needed. Effect deps: the callbacks it
dispatches (`setPlaying`, `setFoldTarget`, `replayFromFlat`, `resetView`,
`pushView`, `setViewSettings`) plus `playing`, `loadState`,
`runConfig.foldStepPercent`.

### Guards (in order)

1. **Ignore typing.** Bail if `target.isContentEditable` or `target.tagName`
   matches `INPUT|TEXTAREA|SELECT` — same regex the CP panel uses.
2. **Ignore foreign modifiers.** Bail if `event.ctrlKey || event.metaKey ||
   event.altKey` so we never clobber menu-bar / browser shortcuts. (We only
   read `shiftKey` for the jump-to-0/100 variants.)
3. **Only when ready.** Bail unless `loadState === 'ready'` — mirrors the
   disabled state on the transport buttons.
4. **preventDefault** for the keys we consume — `Space` (stops page scroll *and*
   the native activation of a focused toolbar button, which fires on Space so a
   single `preventDefault` on keydown suppresses the double-trigger), the arrows
   (stop page scroll), and `+`/`-`/`0`.

### New helper

`nudgeFold(deltaPercent: number)` — thin wrapper:
`setFoldTarget(clamp(foldPercentRef.current + delta, 0, 100))`. `setFoldTarget`
already pauses and drives `runtime.settleTo`, so nothing else is needed.

### Discoverability

- Append the shortcut to the existing (already-i18n'd) button `title`s, e.g.
  `Play (Space)`, `Step (→)`, `Reset (R)`. Zero new layout, immediately visible
  on hover.
- Extend the canvas `aria-label` / `title` to mention "arrow keys scrub,
  space plays."
- Optional: a `?`-triggered shortcuts popover, or a row in the existing
  `HelpModal.tsx`. Recommend deferring unless we want it in this pass.

### i18n

Any changed/added user-facing string (button titles with key hints, the canvas
label, an optional help list) goes through `t('panels:…', 'English default')`,
then `npm run i18n:extract`, translate the 8 locales, `npm run i18n:stamp`,
`npm run i18n:check`. Keeping key hints inside the existing `title` keys means
re-translating those few strings.

## Affected Areas

- `apps/web/src/components/panels/SimulatorPanel.tsx` — keydown effect,
  `nudgeFold` helper, zoom-key + reset-view dispatch, button-title hints,
  canvas label.
- `apps/web/public/locales/*/panels.json` (+ `en` via extract) — updated
  titles / labels for 8 locales.
- (Optional) `apps/web/src/components/HelpModal.tsx` — a simulator-shortcuts
  section.

No engine, worker, or WebGL changes — this is entirely a panel-level input layer
over handlers that already exist.

## Checklist

- [x] Add `nudgeFold` helper over `setFoldTarget` (+ `zoomBy` over `pushView`).
- [x] Add window `keydown` effect with the four guards (typing / modifiers /
      ready / preventDefault).
- [x] Bind timeline keys: Space, ←/→, Shift+←/→, R.
- [x] Bind view keys: 0 / Home (reset view), +/− (zoom).
- [x] Bind toggle keys: F / C / H / L.
- [x] Append key hints to transport + view-toggle button titles. Kept
      `aria-label` pinned to the clean base label (hint lives only in the visual
      tooltip) — so screen-reader names stay "Play"/"Lighting" and no i18n key
      changed (zero translation churn; `i18n:check` untouched).
- [ ] Extend canvas aria-label / title — deferred (would change two translated
      keys; button tooltips already advertise the keys).
- [x] i18n: no `t()` default changed, so no extract/translate needed.
- [x] Add a unit/interaction test for the keymap (Space toggle, Shift-arrow
      jumps, plain-arrow scrub, and typing-in-a-field is ignored). Promise-
      wrapped the in-process session mock so unsettling the model matches the
      comlink contract the runtime assumes.
- [x] `npx tsc --noEmit`, `eslint`, `SimulatorPanel.test.tsx` all green.
- [ ] Browser check (user): scrub/play/reset feel right; keys don't fire while
      editing the fold-percent field or in other workspaces.
- [ ] (Optional, deferred) `?` shortcuts popover / HelpModal entry.

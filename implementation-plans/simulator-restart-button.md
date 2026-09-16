# Simulator Restart Button

## Goal

The Simulate panel's transport has two buttons that both read as "start over":
**Refresh** rebuilds the fold artifacts and loads a new worker session, and
**Reset** rewinds the existing session to flat paper. A user has one intent —
restart — and the split leaked an implementation detail that then went wrong:
a Refresh made the paper turn blue and the camera jump (reported on Discord,
"Simulator Refresh changes camera and paper color", against 0.4.0 on Windows).

Collapse the pair into one **Restart** control that puts the fold back at the
start whatever state the session is in, and make a rebuilt session never draw
with the worker's own defaults.

## Root cause

`refreshFoldArtifacts` nulls `foldArtifacts` before recomputing. The runtime's
load effect treats a null fold as "nothing to show" and releases the worker
session — the only one there is. When the new artifacts land, the worker's
`load` carries camera and palette forward from `latestSession()`, but there is
no session left to carry from, so the new one starts on `DEFAULT_RENDER_SETTINGS`
(front colour `[0.31, 0.51, 0.84]`, the blue) and the default orbit. The
viewport only re-pushes camera and settings when `gpuActive` flips, and the
null branch never resets it, so `true → true` fires nothing. A segment switch
goes non-null → non-null with the previous session still alive, which is why
the worker-side carry-over was enough for it and not for Refresh.

## Approach

1. **Runtime re-asserts a session's inputs.** `useSimulatorRuntime` remembers
   the last camera and render settings it forwarded and re-sends both to every
   new session right after `load` lands and before the opening settle — so the
   first frame of a rebuilt session is already right, with no dependence on
   what the worker had lying around. The worker's carry-over stays as the
   first-load nicety it always was. The null branch also clears `error`, so a
   rebuild does not report the error of a model that is gone.
2. **One Restart control.** The panel's `restartSimulation` rewinds in place
   when the session is healthy (`runtime.reset()`, what Reset did) and rebuilds
   through `refreshFoldArtifacts()` when it is not (what Refresh did) — and in
   both cases puts the view back to its opening transform, so Restart means
   "as if the simulation had just been opened". Disabled while loading or with
   nothing loaded. The `R` key and the context-menu row (`simulator.replay`)
   dispatch the same handler; the shortcut id is kept so saved overrides still
   resolve, and its label becomes "Restart Simulation".
3. **Cmd/Ctrl+arrow jumps, camera untouched.** `simulator.foldStart` and
   `simulator.foldEnd` move from Shift+arrow to Cmd+←/→ — the start-of-line /
   end-of-line idiom. `foldStart` is now a rewind (flat paper, solver at rest)
   rather than a settle back to 0; `foldEnd` still folds to 100%. Neither
   touches the view: they are the way to start over without losing the angle.
   Inline windows share the verbs, so R there also resets the window's view.
4. **Drop the `simulator.refresh` capability.** Only the removed button read it.
5. **i18n.** New `panels:simulator.restart`; reworded `tools:simulator.replay`;
   removed `panels:simulator.refresh` / `reset` and the three
   `common:capability.refresh*` strings. Translated in all eight locales and
   stamped.

## Affected Areas

- `apps/web/src/simulator/useSimulatorRuntime.ts` (+ test)
- `apps/web/src/components/panels/SimulatorPanel.tsx` (+ test)
- `apps/web/src/keyboard/shortcuts.ts`, `apps/web/src/i18n/shortcutLabels.ts`
- `apps/web/src/lib/workspaceCapabilities.ts` (+ test)
- `apps/web/public/locales/**`

## Checklist

- [x] Runtime re-pushes the last camera and render settings to a new session
- [x] Runtime clears `error` when the fold goes away
- [x] Panel: single Restart button, rewind-or-rebuild handler, R + context menu
- [x] Remove the `simulator.refresh` capability
- [x] i18n extract, translate the new/reworded strings in 8 locales, stamp
- [x] Tests: runtime reload re-push; panel Restart branches; capability test
- [x] Restart also resets the view; Cmd+←/→ jump either end and keep it
- [x] Validation: lint, typecheck, i18n check, web unit tests
- [x] Draft PR against `main` — #374

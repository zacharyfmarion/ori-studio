# Viewport Pan Control (CP editor)

## Goal

Add a **Pan "hand tool" toggle button** to the crease-pattern viewport's bottom
toolbar, next to zoom in/out. Clicking it puts the canvas in a pan mode where
plain left-drag pans (no modifier needed). `Cmd/Ctrl`-drag pan keeps working
always.

**Zoom is intentionally untouched.** The mouse wheel already zooms toward the
cursor ([CreasePatternWebglCanvas.tsx:2332][w2332]), which is the behavior we
want. The toolbar +/- buttons and `Cmd +=`/`-` keys anchor to the viewport
center ([:2504-2509][w2504]), but that's fine — the cursor is on the button, not
the canvas, when those fire — so no change there.

Explicitly **out of scope** here (tracked as a follow-up): **view rotation** and
rotate buttons. The camera has no rotation term today ([camera.ts:12][c12]), and
adding one ripples into pan/zoom math, DOM overlays, and grid rendering. That is
"Phase 3" in the earlier discussion and gets its own plan.

## Decisions recorded (cross-platform modifiers)

These are settled and shape the code, even though the M/V binding itself is
future work:

- **Primary/accel modifier = Cmd on macOS, Ctrl on Windows/Linux.** All standard
  app shortcuts stay `Primary+…` (already the case via the `"Primary"` token in
  `keyboard/shortcuts.ts`). Never hard-code `metaKey`/`ctrlKey` for shortcuts.
- **Alt/Option is the designated "third modifier"** for Brandon-style
  hold-to-modify behaviors (e.g. hold-to-toggle-M/V), because it is the same
  physical key on both platforms and is never the accel. **Never bind a behavior
  to bare Ctrl** — on Windows that collides with the accel.
- Consequence for this work: introduce a single `isPrimaryModifier(e)` helper and
  route canvas pan through it, so Ctrl is freed on macOS for the future
  Alt/Ctrl third-modifier scheme. (The Alt-hold M/V binding is **not** built in
  these phases — only the convention is locked in.)

## Approach

### Pan hand-tool toggle

1. **State**: add `panToolActive: boolean` as `CreasePatternPanel` component
   state. Pass it into the canvas (via the existing `liveRef` snapshot the canvas
   reads) and into `ViewportToolbar`.
2. **Toolbar button**: add a `Hand` `IconButton` in `ViewportToolbar` beside
   zoom-in, `isActive={panToolActive}`, toggling the state. New i18n string
   `tools:viewport.pan` ("Pan") — must be added with translations per
   `apps/web/CLAUDE.md` i18n rules.
3. **Canvas pointer handling** ([onPointerDown ~:2021][w2021]):
   - Keep `button === 2` (right-drag erase) as the first branch — it still
     overrides everything.
   - Change the pan branch from `e.metaKey || e.ctrlKey` to
     `isPrimaryModifier(e) || liveRef.current.panToolActive` (button 0 only).
   - When `panToolActive`, **suppress** the tool branches (draw/select/sequence/
     text/etc.) and the hover-preview feed in `pointermove`, so the active rail
     tool is inert while panning.
4. **Cursor**: canvas CSS cursor = `grab` when `panToolActive` idle, `grabbing`
   while a pan drag is in progress.
5. **Mutual exclusivity**: selecting any rail/draw tool clears `panToolActive`
   (one-line hook wherever the panel sets the active tool). `Escape` also exits
   pan mode (extend the existing canvas `Escape` handling). This avoids a
   confusing "two things look active" state.
6. **Modifier helper**: add `isPrimaryModifier(e)` (mac→`metaKey`, else→`ctrlKey`)
   in a shared platform util (reuse the platform detection already in
   `keyboard/shortcuts.ts` if exposed; otherwise a small `lib/platform.ts`).
   Route the pan branch through it.

## Affected Areas

- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — pan-mode gating,
  cursor, `isPrimaryModifier` in the pan branch.
- `apps/web/src/components/panels/ViewportToolbar.tsx` — pan `Hand` toggle button
  + `isActive` prop plumbing.
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — `panToolActive`
  state, pass-through to toolbar + canvas, clear-on-tool-select, Escape exit.
- `apps/web/src/lib/platform.ts` (new or existing) — `isPrimaryModifier`.
- i18n catalogs — new `tools:viewport.pan` key across all 8 locales.

## Edge cases & risks

- *Objects overlay eats the press*: the canvas-object overlay (images / folded
  figures) sits above the canvas and takes the press first ([note at w2033][w2033]).
  So a pan drag that starts on an image won't pan in v1. **Known limitation** —
  acceptable for a first cut; a later pass can have the overlay forward presses
  to pan when `panToolActive`. Document in the button title/help if needed.
- *Dual-active confusion*: mitigated by mutual exclusivity (rail tool select and
  Escape both clear pan mode).
- *Suppressed tool feed leaking*: must gate **both** `pointerdown` tool branches
  and `pointermove` hover previews on `!panToolActive`, or ghost previews render
  under the hand cursor. Explicit checklist item + browser verification.
- *Behavior change on Ctrl-drag*: after `isPrimaryModifier`, macOS Ctrl-drag no
  longer pans (only Cmd-drag does); Windows unchanged (Ctrl-drag pans). This is
  **intended** (frees Ctrl on mac for the future third-modifier) but is a visible
  change — call it out in the PR. Note `dragShift` at [w2073][w2073] also reads
  `metaKey||ctrlKey` for draw-constrain; leave it untouched (separate concern),
  but flag it so we don't forget it's inconsistent.
- *Touch / pen / pinch*: pan-mode left-drag works for touch via pointer events;
  pinch-zoom is not handled and stays out of scope.
- *Focus / contenteditable*: toolbar button clicks must not steal focus mid
  text-edit; `isViewportInteractiveTarget` already guards canvas keys. Verify the
  button uses `type="button"` (IconButton does) and doesn't blur an active editor.

**General**
- *No rotation coupling*: don't add scaffolding for a future rotation term —
  camera stays axis-aligned.
- *Zoom untouched*: this change must not alter any zoom path.

## Validation

Tool-checkable (self-verified before handoff):
- `cd apps/web && npx tsc --noEmit`
- `npm run lint:web`
- `npm run test:web`
- `npm run i18n:check` after adding the `tools:viewport.pan` key + translations

Browser checklist (author-owned):
- Pan button toggles a grab cursor; left-drag pans; rail tool / Escape exits;
  Cmd-drag (mac) and Ctrl-drag (win) still pan with the button off.
- No ghost tool preview while pan mode is active.
- Wheel zoom still zooms to cursor (regression check — unchanged).

## Checklist

- [ ] `isPrimaryModifier` helper + route pan branch through it
- [ ] `panToolActive` state + toolbar `Hand` toggle + `isActive`
- [ ] canvas pan-mode gating (pointerdown + hover feed) + grab cursor
- [ ] mutual exclusivity (tool-select clears; Escape exits)
- [ ] i18n `tools:viewport.pan` + translations, `i18n:check` passes
- [ ] tsc / lint / test:web green
- [ ] PR notes: macOS Ctrl-drag pan behavior change; objects-overlay pan
      limitation; rotation deferred to a follow-up

[c12]: apps/web/src/cp-workspace/renderer/camera.ts#L12
[c87]: apps/web/src/cp-workspace/renderer/camera.ts#L87
[w2021]: apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx#L2021
[w2033]: apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx#L2033
[w2073]: apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx#L2073
[w2332]: apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx#L2332
[w2504]: apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx#L2504

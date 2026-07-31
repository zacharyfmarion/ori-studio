# Control-Held Line Colour Inversion

## Goal

Port Oriedita's held-Control behaviour: while Control is down, the active crease
colour inverts (Mountain ⇄ Valley) for as long as the key is held — the left-rail
chip moves from M to V, the draw preview changes colour, and a crease committed
during the hold lands in the inverted colour. Releasing Control restores the
previously chosen colour with no state left behind.

Scope is the Edit (crease-pattern) workspace. Correct on macOS **and**
Windows/Linux, which is not free: Control is a distinct third modifier on macOS
but *is* the accel on Windows, and Ori Studio already spends Ctrl+drag there.

## Upstream mechanism (Oriedita)

One observable boolean, read through derived getters. The base colour is never
mutated, which is the entire reason release restores cleanly.

**State** — `CanvasModel.toggleLineColor` (`oriedita-data/.../CanvasModel.java:31`),
a plain `boolean` with a `PropertyChangeSupport` setter; `reset()` clears it
(`:167`).

**Set / clear** (`oriedita/.../App.java:210-258`) — root-pane `InputMap` bindings
at `WHEN_IN_FOCUSED_WINDOW`, so they are focus-independent within the window:

- `VK_CONTROL` + `CTRL_DOWN_MASK` → `"CTRLPress"`, guarded (`if (!getToggleLineColor())`)
  so auto-repeat does not re-fire.
- `VK_CONTROL` released → `"Release"` → `setToggleLineColor(false)`. Note the
  quirk that `VK_ALT` released shares the same action, so releasing Alt also
  clears the flag — an artefact of sharing the tooltip-popup teardown, not
  behaviour worth porting.

**Resync** (`oriedita-ui/.../Canvas.java:245`) — every canvas `mouseMoved` does
`canvasModel.setToggleLineColor(e.isControlDown())`. This is a self-healing
correction for a keypress the window-level binding missed.

**Consumption is derived, never mutating** (`CanvasModel.java:128-134`):

```java
public LineColor calculateLineColor() {
    return toggleLineColor ? lineColor.changeMV() : lineColor;
}
public LineColor calculateAuxColor() {
    return toggleLineColor ? auxLiveLineColor.changeAuxColor() : auxLiveLineColor;
}
```

`LineColor.changeMV()` swaps `RED_1`⇄`BLUE_2` and returns `this` for everything
else — Edge (`BLACK_0`) and Auxiliary (`CYAN_3`) do **not** invert.
`changeAuxColor()` swaps `ORANGE_4`⇄`YELLOW_7`.

**Three consumers**, all refreshed by blanket `canvasModel` property listeners:

| Site | Effect |
| --- | --- |
| `CreasePattern_Worker_Impl.java:924-925` | the colour new creases are drawn in |
| `ToolsPanel.java:107` | which of E/M/V/A lights up — the rail movement described in the request |
| `ReferencesTab.java:104-110` | the marker yellow/orange buttons (`calculateAuxColor`) |

**Second, unrelated overload of the same flag**:
`MouseHandlerSelectLasso.java:25` — `Ctrl+lasso` **unselects** rather than
selects. Oriedita deliberately reuses `toggleLineColor` as a general "invert what
this gesture means" modifier.

**Persistence**: `toggleLineColor` is serialised into the `.ori` `canvasModel`
block, and we already honour it on load (`orieditaNativeMetadata.ts:94`).

## Ori Studio today

- Active colour is `const [activeCpLineColor, setActiveCpLineColor] =
  useState<OristudioCpLineColor>('Red1')` — `CreasePatternPanel.tsx:838`.
- Two **write** sites: native-metadata restore (`:1097`) and the rail/toolbar
  click (`:1580`, in `handleCpToolAction`). Both stay on the base colour.
- Five **read** sites, all of which become derived:

  | Line | Read |
  | --- | --- |
  | `:1533` | `buildCpCommandPayload` → `payload.line_color` for all ~30 colour-taking ops (`cpCommandPayloadDefaults:349`) |
  | `:2053` | `toolPreviewColor` — the live WebGL preview stroke |
  | `:2780` | `<CpToolRail activeLineColor>` → `CpToolRail.tsx:423` `isActive` → `data-active` |
  | `:3165` | `<CpContextToolPanel activeLineColor>` |
  | `:3192` | status-bar readout via `cpLineTypeStatusLabel` |

- `toggledLineColor` **already exists** — `orieditaNativeMetadata.ts:329`, a
  byte-for-byte match for `LineColor.changeMV()` — but is module-private and used
  only for metadata restore.
- There is no aux-live-line-colour state; the extra palette (Orange/Magenta/…)
  is defined in `oristudioCpPalette.ts:36` but wired to no UI. `changeAuxColor`
  therefore has no surface to port to.

## Platform analysis

`lib/platform.ts` already states the intended answer in its header: the accel is
Cmd on Apple and Ctrl elsewhere, "which keeps Ctrl free on macOS as a distinct
third modifier."

**macOS — Control is genuinely free.** Two independent guarantees:

- `defaultChordForCpAction` parses the upstream table with `ctrlAsPrimary: true`
  (`shortcuts.ts:379`), so upstream's `ctrl B` becomes Cmd+B, not Ctrl+B.
- `keyChordFromKeyboardEvent` (`shortcuts.ts:559-571`) sets
  `primary = metaKey || ctrlKey` and `ctrl = ctrlKey && !primary`, so `ctrl` is
  *always* false on a real event. A literal-Ctrl chord can never match. And
  modifier-only keys return `null`, so bare Control is not a chord at all and
  cannot be swallowed by the dispatcher.

**Upstream uses Control on every platform, with no branching.** Confirmed three
ways: `App.java` and `Canvas.java` use `VK_CONTROL` / `isControlDown()`
unconditionally (AWT maps Command to `VK_META`, so these are the physical
Control key everywhere); the only `os.name` check near key handling is
`KeyStrokeUtil.java:31`, which is display-only — it swaps the meta-key *glyph*
(⌘ vs ❖) in tooltips; and `hotkey.properties` is a single file with literal
`ctrl` throughout (`undoAction=ctrl Z`, `saveAction=ctrl S`) with no
per-platform variant.

The consequence matters for the decision below: **Oriedita already has Control
doing double duty** — accelerator modifier *and* colour inversion — on Windows
and macOS alike, since it never Mac-ifies its accelerators. So a Ctrl+*key* chord
momentarily flipping the colour while the modifier is down is not a conflict to
solve; it is upstream behaviour on both platforms. Ori Studio's macOS situation
is in fact cleaner than upstream's, because `ctrlAsPrimary: true` moves our
accelerators onto Cmd.

**Windows/Linux — Control is the accel**, which leaves exactly one real
collision: `CreasePatternWebglCanvas.tsx:2423`, where `isPrimaryModifier(e)`
makes Ctrl+drag pan the canvas. That is a direct conflict with
Ctrl+drag-to-draw-inverted, and it is ours, not upstream's — Oriedita has no
modifier-drag pan at all (`Canvas.java` pans on `BUTTON2` only, and maps
`isMetaDown` to middle-click).

**macOS pointer hazard — must be measured, not assumed.** Ctrl+click on macOS is
right-click emulation. Chromium reports `pointerdown` with `button: 0` +
`ctrlKey: true`; **WebKit reports `button: 2`**, which the CP canvas treats as
the universal erase gesture (`CreasePatternWebglCanvas.tsx:2406`). Tauri desktop
is WKWebView, so *Ctrl+drag on the desktop app may erase instead of draw*. The
canvas already `preventDefault`s `contextmenu` (`:2741`), so the browser menu is
not the problem — the erase branch is. Phase 7 probes this on both surfaces
before anything is called done.

**Non-hazard, worth recording**: a trackpad pinch arrives as `wheel` with a
synthetic `ctrlKey: true` and no Control keydown. A keydown/keyup tracker is
immune; a "read `ctrlKey` off the pointer/wheel event" design would not be. This
is one reason the state is tracked from key events rather than sampled per-event.

## Approach

Mirror upstream's split exactly — one boolean, derived reads, base state
untouched — and put the key tracking where AGENTS.md says keyboard behaviour
goes.

**Why a new `keyboard/` module rather than the panel.** The CP surface portals
its floating toolbar, context menus, and inline text editor, so any
container-scoped listener goes dead the moment one of those takes focus — the
first rule in AGENTS.md § Panel components. `DesignPanel`'s space-to-pan
(`DesignPanel.tsx:877-906`, a container `keydown` sitting in the eslint
legacy-keydown debt register) is the shape to *avoid*, not copy. This also
cannot ride the shortcut registry: `SHORTCUT_DEFINITIONS` is chord-based and
`keyChordFromKeyboardEvent` returns `null` for modifier-only keys. A held
modifier is a third input kind, so it gets its own small focus-independent
primitive next to the dispatcher.

### Phase 1 — `apps/web/src/keyboard/heldModifiers.ts` (new)

Window-level, capture-phase modifier tracker.

- `subscribeHeldModifiers(fn) → () => void`, plus `readHeldModifiers()` for
  imperative callers.
- `syncHeldModifiersFromEvent(e: { ctrlKey, altKey, shiftKey, metaKey })` — the
  `Canvas.java:245` resync, exported for Phase 5.
- Ignore `keydown` when `isShortcutEditingTarget(event.target)` — the canonical
  predicate from `shortcutDispatcher.ts`, per AGENTS.md's "one predicate per
  question". Rationale: Ctrl+A in a text field is a normal macOS line-start
  keystroke and should not strobe the rail.
- **Always** process `keyup` and the reset paths regardless of target, so the
  flag can never latch on.
- Reset on `window blur`, `document visibilitychange`, and `contextmenu` — a
  macOS OS shortcut (Ctrl+Up → Mission Control) or Cmd+Tab steals focus and the
  matching `keyup` never arrives.
- No-op on repeat, matching the `if (!getToggleLineColor())` guard in `App.java`.
- Install once from `App.tsx` beside `installAppKeyboardListener`.

**Why a module-level store rather than hook-local `useState` + `useEffect`.**
One reason only: Phase 5's pointer resync writes from an imperative handler
inside the WebGL canvas' `useEffect`, outside React state, and would otherwise
need a callback threaded through a component that already takes ~40 props. Drop
Phase 5 and hook-local state would cover everything — worth knowing before
anyone defends the module on general principle. The 60fps argument that earns
`cpOverlayViewStore` its external store does *not* apply here; a modifier
changes twice per press.

Tests: `heldModifiers.test.ts` — press/release, auto-repeat idempotence, blur and
visibilitychange reset, editing-target suppression on keydown but not on keyup,
listener teardown.

### Phase 2 — promote the swap function

Move `toggledLineColor` out of `orieditaNativeMetadata.ts:329` into
`lib/oristudioCpPalette.ts` as `toggledCpLineColor`, documented as the port of
`LineColor.changeMV()`. `oristudioCpPalette.ts` has no cp-workspace dependency,
so both the metadata restore and the live inversion can share it. Re-point the
existing caller. Unit-test across the whole palette: only `Red1`⇄`Blue2` move;
`Black0`, `Cyan3`, `None` and the extra colours are identity.

### Phase 3 — `apps/web/src/cp-workspace/lineColor/useCpLineColorInversion.ts` (new)

```ts
export function useCpLineColorInversion(base: OristudioCpLineColor): {
  effectiveLineColor: OristudioCpLineColor;
  inverted: boolean;
};
```

Applies `toggledCpLineColor` when the inversion modifier is held, returns `base`
otherwise, and is gated so it is inert outside the Edit workspace. The modifier
itself comes from a single named predicate —
`isLineColorInversionModifierHeld()`, reading `readHeldModifiers()` — so the
platform rule of Phase 6b lives in one place and can change without touching
call sites.

The subscription is one line, and the snapshot is deliberately a **boolean**,
not a modifiers object:

```ts
const held = useSyncExternalStore(subscribeHeldModifiers, isLineColorInversionModifierHeld);
```

A primitive snapshot compares by value, so `getSnapshot` may compute fresh on
every call and React's "the result of getSnapshot should be cached" guard cannot
fire. That is the whole reason the platform predicate is folded into the
snapshot rather than the store publishing `{ ctrl, alt, shift, meta }` — an
object snapshot would reintroduce a caching requirement for no gain. Nothing
here needs `useSyncExternalStore` in the tearing or SSR sense (single
subscriber, no SSR); it is chosen because at one line it is *smaller* than
`useState` + `useEffect`, has no gap between the initial read and the
subscription, and matches `cpOverlayViewStore`.

### Phase 4 — panel wiring

`const { effectiveLineColor: effectiveCpLineColor } = useCpLineColorInversion(activeCpLineColor)`,
then switch the five read sites in the table above. The two write sites keep
using `activeCpLineColor`. Net panel growth ~3 counted lines; no `max-lines`
pressure (`CreasePatternPanel.tsx` is 3307 lines against its `OVERSIZED_PANELS`
entry).

Upstream behaviour that follows from this and should be left alone: clicking M in
the rail *while Control is held* sets the base to Mountain and displays Valley
until release. That is exactly what `calculateLineColor()` does in Oriedita.

### Phase 5 — pointer resync (`Canvas.java:245` parity)

Call `syncHeldModifiersFromEvent(e)` from the CP canvas `pointermove` handler.
One line, and it self-heals a `keyup` lost to a focus change mid-gesture.

### Phase 6 — collisions (each its own commit, independently revertible)

**6a. `dragShift` — remove the ctrl/meta arms.**
`CreasePatternWebglCanvas.tsx:2469` reads
`dragShift = e.shiftKey || e.metaKey || e.ctrlKey`, feeding `additive` on tool
commit, which only matters for `CreaseSelect` / `SelectLasso` / `SelectPolygon`
(`CreasePatternPanel.tsx:1988-1994`). Change to `e.shiftKey`. Justification:

- The `isPrimaryModifier` pan branch (`:2423`) runs *first*, so `e.metaKey` is
  already unreachable on macOS and `e.ctrlKey` already unreachable on Windows.
  What the expression actually means today is "Shift, plus Ctrl on macOS only".
- The sibling click and box select paths (`:2684`, `:2706`, `:2709-2710`) already
  use `e.shiftKey` alone, so this removes an inconsistency rather than adding one.
- It clears Ctrl of a second meaning on macOS before we give it this one.

**6b. Non-Apple pan-drag — the one open decision.** Recommended: **Control on
both platforms** (upstream uses Control on every platform, per the analysis
above), and move the canvas' accel+drag pan off Ctrl on non-Apple. Middle-button
drag and the hand tool both still pan, and upstream has no modifier-drag pan at
all — so this drops an Ori Studio addition in favour of upstream behaviour,
which is the tie-break AGENTS.md sets. Isolated commit so it can be reverted
alone if the pan turns out to be missed in practice.

Alternatives, if that trade is unwanted:

- **Alt on Windows/Linux, Control on macOS.** Keeps Ctrl+drag pan, but diverges
  from upstream on the one platform where upstream's own choice is unambiguous,
  and splits the muscle memory across platforms. Phase 3's single predicate is
  where this would be expressed. Weak: it solves the accel-chord overlap, which
  the analysis above shows is not a problem — upstream has it too.
- **Control everywhere, keep Ctrl+drag pan.** Cheapest, and the worst behaviour:
  on Windows a Ctrl+drag would show an inverted preview and then pan.

### Phase 7 — verification

Tool-checkable (self-verified): `npx tsc --noEmit`, vitest for
`heldModifiers`, `toggledCpLineColor`, `useCpLineColorInversion`, and
`npm run lint:web`. Use `npx tsc --noEmit` rather than `npm run typecheck:web`,
which regenerates tracked wasm bindings.

Browser checklist (Zach owns):

1. Edit workspace, Mountain selected, free-crease tool. Hold Control → rail chip
   moves M→V, status readout and preview stroke follow. Release → back to M.
2. Draw a crease *while* holding Control → it commits as a valley.
3. Edge (E) and Auxiliary (A) selected → holding Control changes nothing.
4. Cmd+Tab away and back with Control still down → no stuck inversion.
5. Focus the CP text editor / a numeric input, hold Control → rail does not
   strobe. Release → nothing latched.
6. **The WebKit probe**: Ctrl+drag on the CP canvas in the Tauri desktop app on
   macOS. If it erases instead of drawing, `pointerdown` is reporting
   `button: 2`, and Phase 6 gains a third item — suppress the erase branch when
   the press carries `ctrlKey` on Apple platforms. Compare against Chromium in
   the browser build, where this is expected to be fine.

## Out of scope

- **`Ctrl+lasso = unselect`** (`MouseHandlerSelectLasso.java:25`). Oriedita's
  second use of the same flag. Ori Studio's lasso is currently *additive* under a
  modifier, so porting this is a behaviour change to selection, not to colour —
  it deserves its own plan. Phase 6a only removes Ctrl from the additive path; it
  does not make it subtractive.
- **`calculateAuxColor` (Orange⇄Yellow)** — no aux-live-line-colour state and no
  UI reaches the extra palette, so there is nothing to invert.
- **`DesignPanel` space-to-pan** adopting `heldModifiers`. A clear follow-up
  (it would retire one entry from the eslint legacy-keydown register), but it is
  a different surface and does not belong in this change.
- Persisting the inversion into `.ori`. Upstream serialises `toggleLineColor`
  and we already read it, but writing a transient modifier state into a saved
  file is an upstream quirk with no benefit; the restore path stays as-is.

## Affected Areas

| Path | Change |
| --- | --- |
| `apps/web/src/keyboard/heldModifiers.ts` | new — focus-independent modifier tracker |
| `apps/web/src/keyboard/heldModifiers.test.ts` | new |
| `apps/web/src/App.tsx` | install the tracker beside `installAppKeyboardListener` |
| `apps/web/src/lib/oristudioCpPalette.ts` | `toggledCpLineColor` (moved + exported) |
| `apps/web/src/lib/oristudioCpPalette.test.ts` | swap coverage across the palette |
| `apps/web/src/lib/orieditaNativeMetadata.ts` | drop the private copy, import the shared one |
| `apps/web/src/cp-workspace/lineColor/useCpLineColorInversion.ts` (+ test) | new — derived colour + platform predicate |
| `apps/web/src/components/panels/CreasePatternPanel.tsx` | 5 reads → derived colour |
| `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` | pointer resync; `dragShift` → shift-only; (6b) pan modifier |

No Rust, wasm, or engine changes — the kernel already takes `line_color` per
command, so inversion is entirely a frontend derivation.

## Checklist

- [ ] Phase 1 — `heldModifiers.ts` + tests; installed from `App.tsx`
- [ ] Phase 2 — `toggledCpLineColor` promoted to `oristudioCpPalette.ts`, caller re-pointed, palette-wide test
- [ ] Phase 3 — `useCpLineColorInversion` + `isLineColorInversionModifier` + tests
- [ ] Phase 4 — five panel read sites switched to the derived colour
- [ ] Phase 5 — `pointermove` resync on the CP canvas
- [ ] Phase 6a — `dragShift` reduced to `e.shiftKey` (own commit)
- [ ] Phase 6b — non-Apple pan modifier resolved per the decision above (own commit)
- [ ] Phase 7 — tsc / vitest / lint green; browser checklist walked, including the WKWebView Ctrl+click probe

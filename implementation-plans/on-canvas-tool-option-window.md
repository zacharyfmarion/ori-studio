# On-canvas tool option window

The stepper for [`vertex-fold-angle-solver.md`](vertex-fold-angle-solver.md)
shipped in the side panel, which is the wrong place: it is chrome *about* three
creases on the canvas, and it sits across the room from them. This moves it onto
the canvas and makes it the shared surface for every tool that offers a list of
choices.

## Goal

A small floating window over the crease-pattern canvas, anchored to whatever the
active tool is talking about, with:

- a **header**: back / `2 of 3` / forward, then **Apply** and **Cancel**;
- a **body**: the things the choice would change, one row each, showing what
  each would become.

Generic by construction, because the choice is not specific to fold angles: it is
"the tool found several answers, here they are, pick one".

## Why this is worth generalising rather than moving

The seam already exists in the kernel. `CreasePatternCommandPayload.candidate_index`
is how a UI tells any operation which of several answers to commit, and several
tools already take one:

| tool | what its candidates are | how you choose today |
| --- | --- | --- |
| `VertexSolveFoldAngles` | sets of three fold angles | side-panel stepper |
| `VertexMakeAngularlyFlatFoldable` | rays that close the vertex | a second click near the ray you want |
| `ParallelDrawWidth` | the two offsets | a click on the side you want |
| `Axiom5`, `Axiom7` | the fold solutions | `candidate_index`, or nearest-to-click |
| `CircleDrawTangentLine`, `CircleDrawConcentricSelect` | tangent/concentric choices | a context-panel checkbox, then nearest |

Three different interactions for one question. Click-to-choose is right when the
candidates are *distinguishable on the canvas* — §4's rays point in different
directions, so clicking one is direct. It is wrong when they are not: the
three-angle solve's branches occupy the **same three creases** and differ only in
their angles, so there is nothing to click at and the choice has to be listed.

So the window is for the second kind, and the first kind keeps its click. That
boundary is the whole design constraint — it is not "replace candidate picking",
it is "give the tools that cannot point at their answers somewhere to show them".

## Approach

### The shape

```
┌───────────────────────────────────┐
│  ‹   2 of 3   ›      Apply Cancel │   header — fixed height, always present
├───────────────────────────────────┤
│  ▬ crease 12      90°  →  −90°    │   one row per changed thing
│  ▬ crease 15     180°  →   45°    │
│  ▬ crease 19       0°  →  135°    │
└───────────────────────────────────┘
```

Rows are descriptors, not components: a leading colour, a label, a before value
and an after value. That is enough for creases and for anything else a tool
changes, and it keeps the window from growing a `crease` special case the first
time a non-crease tool wants it.

### Placement: anchored to model space, sized in CSS pixels

Anchored like [`CpFoldAngleLayer`](../apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.tsx)
— project the anchor through `overlayModelToCss` against the live camera from
`cpOverlayViewStore`, so it tracks pans and zooms without re-rendering the panel.

**It does not scale with zoom, and that is the one thing not to copy from the
inline simulator.** `InlineSimulationLayer` scales because its content *is* model
geometry: a folded figure two grid squares wide should look two grid squares
wide. A tool window is chrome — its text has to stay legible at 10% and must not
swell to fill the viewport at 800%. So it borrows the anchoring and the visual
language, and takes none of `inlineSimulationPlacement`'s
`renderedPxPerModel` transform machinery.

That also removes the reason that module is complicated. It exists to keep a
canvas's layout box stable across camera frames, because a layout write wakes a
`ResizeObserver` and re-renders the simulation. Nothing here has a bitmap, so
`translate()` on a fixed-size box is the whole placement story.

Offset from the anchor by a fixed screen gap, flipped to the other side when it
would leave the viewport, and clamped to stay fully visible. Pure function, unit
tested: `(anchor, windowSize, viewportSize) → {left, top}`.

### Not draggable

The inline simulation windows are draggable because they are documents you
arrange. This one is transient — it appears when a tool has a question and goes
when the question is answered — so a saved position has nothing to be saved
against, and auto-placement that dodges the viewport edge covers the real need.
If it turns out to cover geometry someone wants to see, the fix is a better
offset rule, not a drag handle and a persistence story.

### State stays with the tool

The window renders a descriptor and calls back. It holds nothing:

```ts
interface CpToolOptionWindow {
  anchor: { x: number; y: number };      // model space
  title: string;
  index: number;                          // 0-based
  count: number;                          // 0 ⇒ no counter (a family, say)
  rows: readonly CpToolOptionRow[];
  note?: string | null;                   // the family / already-current sentence
  onStep(delta: number): void;
  onApply(): void;
  onCancel(): void;
}
```

`useVertexSolve` grows one derived value — the descriptor — and everything else
about it is unchanged. A second tool adopting the window writes its own
descriptor and touches nothing here, which is the test of whether the
generalisation was real.

### Keyboard: nothing changes, and that is the point

`←` / `→` / `Enter` / `Escape` already dispatch through
`apps/web/src/keyboard/`, at viewport scope, declining when the tool is not in
review. That is *focus-independent*, so it keeps working when a click on **Apply**
puts DOM focus inside the window — which is exactly the case a container
`keydown` listener would drop, and the reason AGENTS.md forbids one.

One thing to check rather than assume: `isShortcutEditingTarget` must not treat a
focused `<button>` as owning its keystrokes, or the arrows would go dead after
the first click on a header control. It tests for text-editing targets, so a
button should fall through — assert it, since the failure is silent.

### Pointer events

The layer is `pointer-events: none`; the window itself is `auto`. Same rule
`InlineSimulationLayer` uses, and for the same reason: a transparent layer over
the canvas must not eat the drags that draw creases.

### What this removes

`CpVertexSolveStepper` leaves the context-panel portal. The context panel goes
back to what it is for every other tool — instructions and options — and the
choice moves to where the creases are.

## Affected Areas

**New — `apps/web/src/cp-workspace/toolOptions/`**
- `toolOptionWindow.ts` — the descriptor types, React-free
- `toolOptionPlacement.ts` — anchor + size + viewport → CSS box, pure, tested
- `CpToolOptionWindow.tsx` — the presentational window
- `CpToolOptionLayer.tsx` — mounts the descriptor the active tool offers, if any

**Changed**
- `apps/web/src/cp-workspace/foldAngleSolve/useVertexSolve.ts` — derives a
  descriptor; needs the anchor, which means carrying the solve's vertex through
  the review state
- `apps/web/src/cp-workspace/foldAngleSolve/CpVertexSolveStepper.tsx` — deleted;
  its strings move to the descriptor
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — mounts the layer
  beside the other overlays, drops the stepper from the portal
- `apps/web/src/styles/theme.css` — window chrome; `.cp-vertex-solve__*` goes
- `apps/web/public/locales/*` — the row labels and the `before → after` format

**Kernel**
- `crates/oristudio-cp/src/lib.rs` — the preview needs to report each solved
  crease's *previous* angle as well as its new one, or the rows cannot show
  `90° → −90°`. Currently the preview returns only the segments as they would
  become; the before values are in the document, so the frontend can read them
  from `line_ids` without a kernel change. **Prefer that** — it is a lookup the
  frontend can already do, and a second array to keep index-aligned is a
  correctness liability for no gain.

## Checklist

- [ ] `toolOptionPlacement` — offset, edge flip, clamp; pure and unit tested
- [ ] `CpToolOptionWindow` renders header + rows from a descriptor and holds no
      state
- [ ] Anchored through `cpOverlayViewStore`, tracking pan and zoom without
      re-rendering the panel
- [ ] Fixed CSS size at every zoom — asserted, because "looks like the inline
      simulator" is exactly the instinct that would scale it
- [ ] `pointer-events: none` on the layer, `auto` on the window; a drag across
      the canvas behind it still draws
- [ ] Rows show before → after, with the crease's committed colour as the swatch
- [ ] `count === 0` renders the note without a counter (the family case)
- [ ] Arrows and Enter still work after clicking a header button — the focus case
      a panel listener would fail; assert `isShortcutEditingTarget` declines a
      button
- [ ] Escape still cancels and leaves the creases untouched
- [ ] `useVertexSolve` supplies a descriptor; the stepper component is deleted
- [ ] Context panel no longer carries the choice
- [ ] `i18n:check` green
- [ ] A second tool's descriptor sketched in a test — the honest check on whether
      the abstraction is one

## Non-goals

- **Rewiring the tools that click to choose.** §4's rays are distinguishable on
  the canvas and clicking one is more direct than reading a list. The window is
  for candidates that are not pointable.
- **Dragging, resizing, persistence.** Transient chrome; see above.
- **A general floating-panel system.** This is one window, at one anchor, for the
  active tool. If two tools ever need one simultaneously, that is a different
  problem and it can be solved then.
- **Replacing `CpContextToolPanel`.** Options and instructions stay there; only
  the *choice between answers* moves.

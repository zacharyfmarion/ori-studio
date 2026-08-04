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
  ‹  2 of 3  ›   Apply  Cancel        controls — fixed size, on the top edge
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│        the actual creases,    │    transparent frame around the region
│        drawn as the chosen    │    the chosen answer would change
│        answer would leave     │
│        them                   │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**Built as a list first, and that was wrong.** Listing the affected creases with
their before and after angles was redundant twice over: the creases are already
stroked in the colour the answer would give them, and `CpFoldAngleLayer` already
badges each with its angle. The list said the same thing again, in words, while
covering the canvas.

So the window frames the geometry instead. The descriptor carries a model-space
**region**, not rows — which is no less generic: any tool that changes things on
the canvas can say where they are.

### The frame scales, the controls do not

Two kinds of thing, following the camera differently, and this is the one
subtlety.

The **frame** encloses model-space geometry, so it must move and resize with the
camera exactly as that geometry does — otherwise it stops surrounding the creases
it is about, which is its entire job. Projected like
[`CpFoldAngleLayer`](../apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.tsx)'s
badges, through `overlayModelToCss` against the live camera from
`cpOverlayViewStore`, so it tracks a pan or zoom without re-rendering the panel.

All **four** corners are projected, not two: the view can be rotated, and a box
built from min/max alone would then be the wrong rectangle — cutting the geometry
on one diagonal.

The **controls** are chrome. Scaling them with the camera is what
`InlineSimulationLayer` deliberately avoids for its badge, and for the reason
that applies doubly here: text that stayed legible at 10% zoom would fill the
viewport at 800%. They are a fixed-size block positioned against the frame's top
edge, above it where there is room and inside it where there is not — never
below, because below covers whatever is outside the frame while inside overlaps
only what the user is already looking at.

Both rules are pure functions, unit tested, including the rotated-view case and
the minimum frame size that keeps three short creases at low zoom from
collapsing the frame into a smudge.

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
  bounds: { minX: number; minY: number; maxX: number; maxY: number };  // model space
  title: string;
  index: number;                          // 0-based
  count: number;                          // 0 ⇒ no counter (a family, say)
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
- `crates/oristudio-cp/src/lib.rs` — the preview names the vertex in
  `preview.points`, so the window frames the point the creases meet at rather
  than re-deriving it and risking a disagreement with the solve about which
  endpoint that is.

## Checklist

- [x] `toolOptionFrame` / `toolOptionChromePlacement` — projection, four corners, minimum size, edge flip, clamp; pure and unit tested
- [x] The layer renders a frame + controls from a descriptor and holds no state
- [x] Anchored through `cpOverlayViewStore`, tracking pan and zoom without
      re-rendering the panel
- [x] The frame scales with the camera and the controls do not — both asserted, because scaling the controls is exactly the instinct "looks like the inline simulator" invites
- [x] `pointer-events: none` on the layer, `auto` on the window; a drag across
      the canvas behind it still draws
- [x] The frame is transparent and click-through, so the creases inside stay visible and drawable
- [x] `count <= 1` shows the title rather than a counter (the family case)
- [x] Arrows and Enter still work after clicking a header button — the focus case
      a panel listener would fail; assert `isShortcutEditingTarget` declines a
      button
- [x] Escape still cancels and leaves the creases untouched
- [x] `useVertexSolve` supplies a descriptor; the stepper component is deleted
- [x] Context panel no longer carries the choice
- [x] `i18n:check` green
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

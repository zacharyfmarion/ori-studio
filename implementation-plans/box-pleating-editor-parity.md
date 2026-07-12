# Box Pleating Editor — Exact Parity With BP Studio (Manual Packing)

## Goal

Bring the BP Editor (packing pane) to **exact functional parity with Box
Pleating Studio's manual editor**: placing, dragging, and editing flaps, rivers,
stretches, devices, and the sheet by hand, with the crease pattern updating
correctly in lockstep. **The optimizer is explicitly out of scope** — a valid
packing is reached by hand; the optimizer is only a convenience.

## Status (2026-07-11)

The **BP Studio Core now runs as a headless oracle** under Bun
(`tools/bp-studio-oracle/layout-graphics.ts`), so engine output is checked
byte-for-byte against BP Studio instead of by eye. Verified: `move_flap` +
`project_graphics_snapshot` match BP Studio exactly. Two real engine
divergences found and fixed against the oracle:
- **Missing leaf flaps** — leaves with no `layout.flaps` entry were invisible +
  un-draggable; now every leaf is seeded a default flap (commit `83f45caf`).
- **Spurious gadgets** — a device was generated between distant flaps; ported
  BP Studio's `junctionTask` AABB-intersection gate (commit `60052f05`).

So the **engine packing pipeline (seeding, moves, junctions, stretches,
devices) is oracle-faithful**. Remaining work is mostly **frontend interaction
parity** and the per-layer rendering audit. Phase status marked inline below.

## Guiding principle (the model we must match)

BP Studio's editor is **Core-driven**:

1. An interaction (drag/nudge/sheet op) mutates the model at a **discrete,
   grid-snapped** step (`dragController.$process`: the pointer is rounded to the
   integer grid via `$round`, and an update fires only when that snapped
   position actually changes — `CursorController.$tryUpdate`).
2. The **Core** recomputes **all** affected graphics for that step (dependency
   order: height → balance → structure → aabb → {junction, roughContour} →
   {invalidJunction, stretch, traceContour} → {pattern, patternContour} →
   graphics).
3. The view renders the Core's output. Flap rectangles, contours, ridges,
   hinges, axis-parallel lines, junctions, and shades all move **together**.

Our Rust engine already implements step 2 faithfully and returns a complete
snapshot after every operation. **So the frontend's job is to drive the engine
per snapped interaction step and render the returned snapshot — not to maintain
a partial optimistic preview.** The current code does the opposite, which is the
root of the breakage (see the assessment in the commit history / memory).

## Current state (what's wrong)

- **Interaction model is a quick approximation.** `BpPackingPanel.displayPacking`
  optimistically moves only the flap **rectangles** during a flap drag; the
  creases/junctions/stretches (`graphics`) are left in place (only translated for
  a *device* drag). Real geometry arrives from an async, rAF-throttled Comlink
  round-trip that lags the pointer and desyncs from the preview → detached
  creases, phantom junctions, jumps, disappearing flaps.
- **Grab offset** was missing on flap drag (fixed) — one of several drag bugs.
- **Flap seeding is off-model:** new flaps are seeded from the tree vertex
  position (`relative_layout_point`), and our tree is length-faithful/continuous,
  so flaps can start off the integer grid. In BP Studio the flap packing
  position is independent of the tree diagram and always on the grid.
- Interaction surface is **incomplete**: river `goToDual`, stretch config/pattern
  cycling, box-select, and some sheet ops aren't wired end to end.

## Approach

### Phase 0: Ground truth + audit harness

- [~] Re-expose a **known-good BP Studio sample loader** (the `bp-studio`
      fixtures already exist; `loadOristudioBpExample` still exists in the slice)
      behind a menu/dev affordance, so we always have a valid packing to compare
      against.
- [x] Stand up a side-by-side reference: the pinned BP Studio build (vendored)
      or the live app, on the same sample, to compare behavior exactly.
- [x] Write a short parity checklist doc (this file's checklist) and drive every
      item against the sample.

### Phase 1: Rework the interaction/update model (keystone)

- [x] Replace the optimistic-rectangle preview + async throttle with a
      **discrete, snapped, engine-driven** loop:
  - On pointer move, compute the grid-snapped target (already rounding in
    `eventToPackingPoint`); **only act when the snapped anchor changes** (mirror
    `$tryUpdate`).
  - Apply the move to the engine (`dragging: true`) and render the **returned
    full snapshot** — drop the partial `displayPacking` preview.
- [~] Measure the worker round-trip latency on a representative design. If it's
      within a frame budget, no preview is needed. If not, evaluate a *complete*
      preview (moving contours+junctions with the flap) vs. a synchronous engine
      path — but avoid re-deriving the pattern engine in JS.
- [~] Ensure drag start/end/cancel are clean: one history entry per drag
      (`is_dragging` coalescing), correct final commit, pointer-capture release.

### Phase 2: Fix tree ↔ packing seeding

- [x] New/edited flaps must be seeded on the **integer grid**, independent of the
      continuous tree-diagram angles. Reconcile the add-leaf flow so it does not
      push length-faithful tree positions into flap positions; use BP Studio's
      "closest empty grid spot" semantics.
- [x] Confirm existing flaps in a loaded sample keep integer positions through
      edits.

### Phase 3: Flap interaction parity

- [x] Select: single, shift/ctrl toggle, and **box/rubberband** multi-select
      (BP Studio `SelectionController.$processDragSelect`: rectangle selects flaps
      whose center is inside; ctrl/meta preserves the pre-drag selection).
- [~] Drag: grid-snapped, **grab-offset preserved** (done), **group drag** (done),
      `constrainFlap` boundary rules (at most one tip beyond the sheet) —
      implemented, not yet oracle-checked.
- [x] Keyboard nudge (arrow keys) with the same constrain rules.
- [x] Hover/long-press inspector.
- [ ] **Click-again to cycle stacked objects** (BP Studio
      `SelectionController.$processNext` / `$hitTestAll`). Selection currently
      uses a fixed hit-test priority (smaller flap wins over a larger one at its
      center; a stretch gadget wins over a flap hit-target in the river between
      flaps). This resolves the common cases, but when a flap tip falls *inside*
      a gadget contour (dense packings) it can only be reached by an off-center
      click or box-select. The robust fix is to gather all selectable items at
      the click point and, on repeated clicks at the same spot, cycle the
      selection to the next one underneath.

### Phase 4: Rivers, stretches, devices, junctions

- [ ] **River**: select, shade highlight, and `goToDual` — selecting a river
      highlights/【selects】the corresponding tree edge in the Design pane
      (cross-pane selection).
- [x] **Stretch**: select and **cycle configurations/patterns** — the GOPS
      pattern navigation. Contextual BpPackingStretchNav shows config/pattern
      steppers (±1 wraparound); the stretch is completed on select to populate
      counts. Verified live cycling patterns on micrathena-sagittata.
- [~] **Device**: select, range-constrained diagonal drag (already offset-aware),
      nudge — implemented; not yet oracle-checked.
- [ ] **Invalid junction**: render overlap conflict polygons and select them;
      they must appear/disappear correctly as flaps move (validity feedback is
      how you know a hand-placed packing is valid).

### Phase 5: Sheet operations

- [ ] Subdivide, rotate (±), flip (h/v), and grid-type (rect/diagonal); resize.
- [ ] Verify flaps re-map correctly across sheet transforms (BP Studio moves
      flaps to stay in range on grid changes).

### Phase 6: Rendering fidelity audit (per layer)

Against a known-good sample, verify each layer matches BP Studio in presence,
geometry, and update-in-lockstep:

- [ ] Flap **contours/edges**; **shade** (rivers); **hinge**; **ridge**;
      **axis-parallel**; **junction**; **dots**; **labels**.
- [ ] Widths use non-scaling strokes (constant on-screen), colors use the app
      tokens (done), and everything redraws together on every edit.
- [ ] Confirm per-flap/per-device internal creases render (the "ridges on the
      flaps"), not just connecting ridges.

### Phase 7: Parity QA

- [ ] Drive the full checklist on the sample set side-by-side with BP Studio.
- [~] Add unit tests for the pure geometry/constrain/selection helpers and the
      snapshot mapping.
- [ ] `lint` / `typecheck` / `test:web` / production build.

## Affected areas

- `apps/web/src/components/panels/BpPackingPanel.tsx` — interaction/update
  model, selection, drag, stretch/river/device wiring, rendering.
- `apps/web/src/lib/bpPackingViewport.ts` — constrain/geometry helpers.
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` +
  `oristudioBpRuntime.ts` — per-step move application; wire
  switchStretchConfig/Pattern, completeStretch, goToDual selection.
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` (add-leaf) —
  grid-integer flap seeding.
- Engine only if a genuine port bug is found during Phase 6 (treat as a separate
  fix with an oracle test).

## Non-goals
- The optimizer (convenience only; out of scope).
- The tree editor's length-faithful model (already a deliberate divergence;
  Phase 2 only fixes how it seeds flap positions).

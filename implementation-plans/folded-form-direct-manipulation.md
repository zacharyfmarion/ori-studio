# Folded Form Direct Manipulation, Undo Coverage + Aspect-Ratio Defaults

## Goal

Three changes to the CP edit surface's direct-manipulation layer:

1. **Folded forms behave like images and text boxes.** Click to select, drag the
   body to move, drag handles to scale, drag the corner rings to rotate — the
   same chrome, the same gestures, the same undo entries. Today a folded form is
   moved only by cmd/ctrl-drag and scaled only via a context-menu "Scale" arm
   followed by a vertical drag, and it cannot be rotated at all.
2. **Aspect ratio is preserved by default when resizing.** Images resize
   proportionally unless Shift is held (Shift = free/non-uniform). Folded forms
   are always proportional (a folded form has no meaningful non-uniform scale).
   Text boxes keep today's behavior (free by default, Shift locks) — a text box
   reflows, so proportional resize is the wrong default there.
3. **Every folded-figure edit goes through the undo stack.** Not just the new
   move/resize/rotate gestures — colors, display style, side, shadow, alpha,
   fold case, starting face, duplicate, delete, and the fold itself. Today
   *none* of them are undoable, and none of them even mark the project dirty.

Non-goal: merging folded forms into the `CanvasAnnotation` data model. They keep
their own kernel-backed lifecycle (handle, snapshot, fold status). Only the
*interaction* substrate is shared.

## Current architecture

Read before touching anything — the two objects live in different coordinate
spaces and different state stores, and that is the crux of this change.

### Annotations (images + text) — the target behavior

- Model: `cp-workspace/annotations/annotationBase.ts` — every annotation carries
  `{ center, width, height, rotation, z, opacity, locked, hidden }` in **CP model
  coordinates**. `annotation.ts` unions the `image` and `text` payloads.
- Interaction: `cp-workspace/CpAnnotationOverlay.tsx` — an absolutely-positioned
  SVG above the WebGL canvas. It draws a transparent hit polygon per annotation
  plus 8 resize squares and 4 rotate rings for the selected one, and owns the
  `move` / `resize` / `rotate` pointer gestures. Handle positions project through
  `CpOverlayView` (the camera's model→CSS affine) so chrome tracks the object
  under zoom and rotation.
- Transform math: `cp-workspace/images/cpImagePlacement.ts` —
  `resizeImage(box, handle, pointerModel, aspectLock)` and `snapAngle` are
  already kind-agnostic (they take an `AnnotationBox`, not a `CpImage`); only
  `cropImage` is image-specific. The module name and `resizeImage`/
  `CpImageResizeHandle` names are stale.
- State: `oristudioCpAnnotations` + `oristudioCpSelectedAnnotationId` on the
  workspace store. Undo goes through `recordAnnotationHistory(previous, label)`,
  which pushes an `annotationsOnly` CP history entry — undo swaps the annotation
  layer without reloading the wasm document.

### Folded figures — what exists today

- State: `oristudioCpFoldedFigures: OristudioCpFoldedFigureEntry[]` plus
  `oristudioCpActiveFoldedFigureId`, in `slices/creasePatternSlice.ts`.
- Geometry: the kernel emits a **render snapshot** (`renderSnapshot.primitives`,
  Oriedita's Java2D draw calls ported in `crates/oristudio-cp/src/folding.rs`).
  `adapters/cpFoldedToScene.ts` flattens curves, triangulates fills with earcut,
  and maps each point through `modelPointToCpSvg(p, ORIEDITA_PAPER_BOUNDS)` plus
  the entry's `displayOffset` — producing **SVG user coordinates**.
  `foldedFigureUserBounds()` computes the AABB the same way for picking.
- Rendering: all figures share one fill buffer + one stroke buffer, drawn with
  `frame.userView` (`reglRenderer.ts`), *not* the model view the creases use.
- Move: `CreasePatternWebglCanvas` `onPointerDown` → cmd/ctrl over a figure sets
  `movingFigure`, `onPointerMove` calls `onMoveFoldedFigure(id, deltaUser)` →
  `moveOristudioCpFoldedFigure` accumulates into `entry.displayOffset`. **No undo
  entry is recorded** — folded moves are silently unundoable today.
- Scale: context menu "Scale" sets `pendingScaleFigureId` in the panel →
  `scaleFoldedFigureId` prop arms the canvas → the next drag previews via
  `cpFoldedToScene(figures, { figureId, factor, pivot })` (a full CPU rebuild per
  pointermove) → release calls `onScaleFoldedFigure(id, scale)` →
  `updateOristudioCpFoldedFigureModel(id, { scale })`, an **async wasm round-trip**
  that re-renders the snapshot.
- Rotate: not implemented on the surface. `FoldedFigureModel.rotation` exists
  (degrees) but is only ever populated from imported `.ori` metadata.

### Two problems the current scale path has

1. `OrieditaRenderCamera::from_oriedita_parts` applies rotation and zoom about the
   *origin*, then `fix_to_flat_bounds` re-anchors `display_position` so the
   figure's min corner lines up with the flat CP bounds. So the committed scale
   anchors the figure's **min corner**, while the drag preview scaled about its
   **bbox centre** — the figure visibly jumps on release. Rotation through
   `model.rotation` would be worse (rotation + re-anchor = a translation the user
   never asked for).
2. Committing through the kernel is async, so a gesture cannot be live.

Both disappear if placement becomes a web-side display transform (below).

### The complete folded-figure mutation surface

Every store action that mutates a folded figure, where it is reachable from, and
what it costs. All UI call sites are in `CreasePatternPanel.tsx` (plus
`projectSlice.ts` for close/clear), so the surface is fully contained.

| Action | UI entry point | Kernel work | Undoable today | Marks dirty |
| --- | --- | --- | --- | --- |
| `foldOristudioCpDocument` | Fold toolbar button | `foldFigure` (expensive) | no | **no** |
| `foldAnotherOristudioCpFigure` | Fold-another button | `foldFigureAnother` — advances an internal case cursor | no | **no** |
| `foldOristudioCpFigureToCase` | Case field / go button | `foldFigureToCase(objective)` | no | **no** |
| `updateOristudioCpFoldedFigureModel` | Colors ×3, Side, Shadow, Color-alpha, Alpha slider, context-menu Flip | `setFoldedFigureModel` + re-render | no | **no** |
| `setOristudioCpFoldedFigureDisplayStyle` | Display select, context-menu Wireframe / X-ray | re-render only | no | **no** |
| `duplicateOristudioCpFoldedFigure` | Menu + context-menu Duplicate | `duplicateFoldedFigure` (new handle) | no | **no** |
| `deleteOristudioCpFoldedFigure` | Menu + context-menu Delete | `freeFoldedFigure` | no | **no** |
| `moveOristudioCpFoldedFigure` | cmd/ctrl-drag | none (web-side offset) | no | **no** |
| `setOristudioCpActiveFoldedFigure` | figure list, right-click | re-render (selection marker) | n/a (view state) | n/a |
| starting-face field | menu `Start` input | feeds the *next* fold | n/a (draft) | n/a |
| `clearOristudioCpFoldedFigures` | project close/replace | frees all handles | n/a | n/a |

Two adjacent gaps this exposes, worth fixing in the same pass:

- **Nothing here sets `dirty: true`.** Fold a model, recolor it, close the app —
  no unsaved-changes prompt, and the work is gone. Routing these through history
  fixes it for free (`recordAnnotationHistory` already sets `dirty`).
- **`updateOristudioCpFoldedFigureModel` has no request sequencing.** It is async
  with no guard, so dragging the alpha slider or the OS colour picker fires a
  round-trip per `change` event and the responses can land out of order —
  last-write-wins is not guaranteed. The coalescing this plan adds also fixes
  the ordering.

### Why folded undo can be a state snapshot, not a command replay

The finding that makes this tractable: **a folded figure entry renders entirely
from `entry.renderSnapshot`**, which is plain serializable data — already
persisted in `.osf` and already the thing `cpFoldedToScene` consumes. The wasm
`handle` is needed only to perform *further* kernel operations, never to draw.

Proof it already works this way: `nativeProjectFile.ts` writes every entry with
`handle: null`, and a reopened `.osf` draws its folded figures correctly from the
persisted `renderSnapshot`. The panel's `ready` guard
(`status === 'ready' && handle !== null && snapshot !== null`) is what disables
the kernel-backed menu items for those handle-less entries.

So undo/redo can restore `oristudioCpFoldedFigures` verbatim — no kernel replay,
no re-fold, no inverse-command algebra — exactly like the annotation-layer fast
path. That is the whole design.

The one thing that needs care is **handle ownership**, below.

### Coordinate-space mismatch (the one real design constraint)

`CpOverlayView` — what the annotation overlay projects through — is the **model**→
CSS affine, built from the panel's `editableModelToSvg`. That callback routes
through `orieditaObjectToSvg(point, nativeCreasePatternCamera)` when an imported
`.ori` carries a native camera, and falls back to
`modelPointToCpSvg(p, ORIEDITA_PAPER_BOUNDS)` otherwise. Folded figures always
use the fallback and are drawn with `userView`. So for a `.ori` with a native
camera the two spaces diverge, and folded chrome projected through the model view
would land in the wrong place.

Two ways out:

- **(A) chosen)** Report a second overlay view for **user** space alongside the
  model one, and let each canvas object declare which space it lives in. Zero
  rendering change; the overlay gains one small generalization.
- **(B) deferred)** Map folded geometry through `modelToSvg` and draw it with the
  model view, so folded figures become ordinary model-space objects and the whole
  `userView` special case shrinks. This is arguably a latent bug fix — today a
  `.ori` with a native camera draws its creases through the camera and its folded
  figure *not* through it — but it changes rendering for every `.ori` import and
  deserves its own change with fixtures. See "Open question".

## Approach

### 1. One placement, web-side, for folded figures

Replace `displayOffset` with an explicit placement on the entry:

```ts
/**
 * Web-side display placement of a folded figure, in SVG user coordinates.
 * Applied about the figure's *local* bbox centre `c0` (the centre of its render
 * snapshot before placement), so scale and rotation are both about the centre
 * the user sees:  p ↦ c0 + offset + R(rotation) · scale · (p − c0)
 */
export interface FoldedFigurePlacement {
  offset: Point;    // user units; reduces to today's displayOffset at identity
  scale: number;    // uniform
  rotation: number; // radians CCW
}
```

Because `offset` at `scale: 1, rotation: 0` *is* `displayOffset`, existing `.osf`
files load with no migration beyond reading the old key into the new field.

The kernel `model.scale` / `model.rotation` are **left alone**. They are only ever
seeded from imported `.ori` metadata (`foldedFigureModelFromOrieditaMetadata`),
they are baked into the render snapshot, and they are never written back on export
— `crates/oristudio-cp/src/io/ori.rs` carries `foldedFigureModel` through as an
opaque blob. So there is no export regression and no second source of truth for
what the user manipulates: the placement is the only thing the gestures touch.

This **deletes** the async scale path: `scaleFoldedFigureId`,
`onScaleFoldedFigure`, `onScaleFoldedFigureEnd`, `pendingScaleFigureId`, the
"Scale" context-menu item, `FoldedFigureScalePreview`, and the `scalingFigure`
branch of the canvas pointer handlers all go away, along with the corner-jump bug.

### 2. Cache local geometry so gestures are cheap

`cpFoldedToScene` currently re-flattens curves and re-runs earcut over every
figure on each call, and the scale preview calls it per pointermove. Adding
rotate/move/scale as live gestures makes that the hot path. Split it:

- `foldedFigureLocalGeometry(entry)` → flattened + triangulated float arrays in
  local user space, plus the local bbox. Memoized on `entry.renderSnapshot`
  identity (a `WeakMap` keyed by the snapshot object).
- `applyFoldedPlacement(local, placement, out)` → a per-vertex similarity
  transform into the shared buffers. O(vertices) float math, no earcut.

`foldedFigureUserBounds` then falls out of the cached local bbox + placement, and
the preview special case disappears (a live gesture just writes the placement).

### 3. Extract a kind-agnostic interaction substrate

`CpAnnotationOverlay` is already 90% kind-agnostic — it consumes `AnnotationBase`
and only branches on `isImageAnnotation` for crop. Generalize it rather than
copying it:

```ts
/** Anything the CP surface lets you select, move, resize and rotate. */
export interface TransformableCanvasObject {
  id: string;
  /** Which affine projects this object's box to CSS: the CP model view, or the
   *  user-space view folded figures are drawn in. */
  space: 'model' | 'user';
  box: { center: Vec2; width: number; height: number; rotation: number };
  locked: boolean;
  hidden: boolean;
  /** Resize keeps the aspect ratio unless the escape modifier is held. */
  aspectLock: 'always' | 'default-on' | 'default-off';
  canRotate: boolean;
}
```

- New `cp-workspace/canvasObjects/transformableObject.ts` holds the interface plus
  the pure adapters `annotationAsTransformable(a)` and
  `foldedFigureAsTransformable(entry, localBounds)`.
- `CpAnnotationOverlay` is renamed `CanvasObjectOverlay` and takes
  `readonly TransformableCanvasObject[]` plus per-object callbacks. Image crop
  (double-click → crop handles) and text edit (double-click → inline editor) stay
  as the two kind-specific escapes, passed in as optional capability callbacks
  rather than checked inline.
- `cpOverlayViewStore` grows from one view to `{ model, user }`; the canvas
  already computes both (`view` and `userView` in `renderNow`) and reports the
  model one via `onViewChange` — report both.

### 4. Aspect-ratio defaults

- `resizeImage` → renamed `resizeAnnotationBox`, and `aspectLock` is honored on
  **edge** handles too (today it is silently ignored unless `sx !== 0 && sy !== 0`).
  With lock on, an edge drag scales both axes from the dragged axis. New tests.
- A single pure resolver, so the rule is declared once and testable:

  ```ts
  export function resizeAspectLock(
    object: TransformableCanvasObject,
    shiftKey: boolean
  ): boolean {
    switch (object.aspectLock) {
      case 'always':      return true;         // folded figure
      case 'default-on':  return !shiftKey;    // image
      case 'default-off': return shiftKey;     // text box
    }
  }
  ```

- Folded figures expose only the 4 corner handles (plus rotate rings) — 8 handles
  on an always-uniform object is misleading chrome.

### 5. Folded-figure edits in the undo stack

**Snapshot the entry list, not the placement.** The earlier draft of this plan
added only `foldedPlacements` to the history entry. Given the finding above, that
is the wrong granularity — capture the whole list instead:

```ts
export interface OristudioCpHistoryEntry {
  document: OristudioCpDocumentSnapshot;
  selection: OristudioCpSelection;
  annotations: CanvasAnnotation[];
  /** Folded figures as they were before the recorded action. Entries carry their
   *  own renderSnapshot, so restoring is a plain assignment — no kernel replay. */
  foldedFigures: OristudioCpFoldedFigureEntry[];
  activeFoldedFigureId: string | null;
  /** True when the action touched only the overlay layers (annotations and/or
   *  folded figures), so undo/redo skips the wasm document reload. */
  overlayOnly?: boolean;   // renamed from annotationsOnly
  label: string;
  timestamp: string;
}
```

Every folded action becomes: snapshot the list → do the work → record. One
helper, mirroring `recordAnnotationHistory`:

```ts
recordFoldedFigureHistory(previous: OristudioCpFoldedFigureEntry[], label: string)
```

Because folding never mutates the CP document (`foldOristudioCpDocument` reads it
and pushes no history entry today), *every* action in the table above is an
`overlayOnly` entry. That includes fold, duplicate and delete — an undo of a
fold is just "restore the shorter list".

**Handle ownership.** `deleteOristudioCpFoldedFigure` currently calls
`freeFoldedFigure` immediately, so a naive undo would restore an entry whose
handle is dangling — it would draw fine but its kernel-backed menu items would be
disabled, i.e. delete/undo would silently downgrade the figure. Fix by making
freeing a function of *reachability* rather than of the delete action:

- New `cp-workspace/foldedFigureHandles.ts`: `retain(handle)` / `release(handle)`
  refcounts, with the actual `freeFoldedFigure` call on the 1→0 transition.
- Retain when an entry enters the live list or a history entry; release when it
  leaves either. Sites: fold / duplicate (create), delete (leave live list),
  history push (enter past/future), history eviction past `MAX_CP_HISTORY`,
  `clearOristudioCpHistory`, `clearOristudioCpFoldedFigures`, document close.
- Net effect: a deleted figure's wasm slot survives exactly as long as it is
  reachable by undo, and is freed when it scrolls off the stack.

Fallback if refcounting proves fiddly: free on delete and let undo restore a
`handle: null` entry — it draws correctly and stays movable/resizable (placement
is web-side now), but needs a refold before further kernel edits. That is the
same fidelity as reopening a saved `.osf`, so it is defensible; it is just worse.
Prefer the refcount.

**Measured cost.** Both halves of the retained state, from a throwaway probe
(counting global allocator around a full `Order5` fold, plus the serialized
render snapshot) over the real CP fixtures in the repo:

| CP | segments | wasm handle | render snapshot (JSON) |
| --- | --- | --- | --- |
| `birdbase.cp` | 26 | 5.8 KiB | 3.4 KiB (8 primitives) |
| `solution_sample_1.cp` | 44 | 27.4 KiB | 27.8 KiB (70) |
| `glitch.cp` | 117 | 71.7 KiB | 93.7 KiB (213) |

Roughly linear over that range at **~0.6 KiB of wasm per segment**. Caveat: 117
segments is the largest real CP in-repo, and `InitialHierarchy.relations` is
worst-case O(subfaces²), so a production-scale box-pleat could grow faster than
this sample shows. Synthetic accordions and map folds bail out of the layer
search early and are not representative (~0.05 KiB/segment) — don't use them to
extrapolate.

Two conclusions:

- **Handles are the cheap half, and refcounting adds very little.** An ordinary
  edit (colour, display style, side) mutates the *existing* handle — it never
  allocates a second one. So the only extra retention is handles for figures that
  were **deleted and are still reachable by undo**. Deleting three glitch-scale
  figures retains ~0.2 MB. The pathological case — creating and deleting 100
  folded models without saving — is bounded by `MAX_CP_HISTORY` at ~7 MB.
- **The retained render snapshots are the bigger line item**, and that cost
  arrives the moment we snapshot the entry list at all — it is not caused by the
  handle decision. Mitigating it is structural sharing, which we get for free:
  entries are immutable and the slice `.map()`s, so an unchanged figure's
  `renderSnapshot` is the *same object* across every history entry. Retained
  versions = the number of **rendering-changing** actions in the window, not the
  history depth.

That makes **coalescing the dominant memory lever**, not refcounting: without it,
one drag of the alpha slider retains ~100 distinct 94 KiB snapshots (~9 MB of
JSON-equivalent, more as live JS objects) on a glitch-scale figure. With it, one.
Coalescing is already in the plan for correctness; it is load-bearing for memory
too.

If production numbers ever say otherwise, the next lever is dropping
`renderSnapshot` from history entries older than the newest few versions and
re-rendering on restore — cheap precisely *because* refcounting kept the handle
alive. Not worth building up front.

**Coalescing continuous controls.** The three colour inputs (`type="color"`) and
the alpha `range` fire `change` continuously while dragging. Without coalescing
each drag would push dozens of history entries *and* dozens of wasm round-trips.
Reuse the existing gesture pattern — the same `onGestureStart` / `onGestureCommit`
shape the annotation overlay already uses:

- `onPointerDown` / `onFocus` → snapshot the list once.
- `onChange` → apply live (see sequencing below), record nothing.
- `onPointerUp` / `onBlur` → one history entry, e.g. "Change folded model color".
- A small `FoldedFigureGestureScope` helper in the panel keeps the three colour
  inputs and the slider from each hand-rolling this.

**Request sequencing.** Give `updateOristudioCpFoldedFigureModel` a per-figure
monotonic request id (the slice already uses this pattern for
`foldedFigureRequestSequence`): a response whose id is not the latest for that
figure is dropped. This makes a fast slider drag land the last value rather than
whichever round-trip returned last.

**Discrete actions** (Flip, Wireframe, X-ray, display style, fold case, duplicate,
delete, fold, fold-another) each record one entry directly, with a specific label
so the undo toast reads correctly: "Fold model", "Duplicate folded model",
"Delete folded model", "Change folded display style", "Change fold case", …

**A bonus fix:** CP edits mark generated figures `stale`
(`staleGeneratedFoldedFigures`) but the history entry doesn't capture them, so
undoing a crease edit leaves the figure stale forever. Once entries carry the
figure list, undo restores `status: 'ready'` along with it.

### 6. Selection, undo, persistence

- **Selection.** Reuse `oristudioCpActiveFoldedFigureId` as the canvas selection
  for folded figures (right-click already sets it, and it already drives the
  kernel's `selected` render marker), and make it mutually exclusive with
  `oristudioCpSelectedAnnotationId` **in the store slices**, not in the panel, so
  the invariant can't drift. `activeGeneratedFoldedFigure()` already falls back to
  the first generated figure, so the folded-figure toolbar menu keeps a target
  when the canvas selection moves to an annotation.
- **Undo.** Covered in full by section 5; the placement gestures are just three
  more callers of `recordFoldedFigureHistory`.
- **Persistence.** `nativeProjectFile.ts` `validateFoldedFigure` reads
  `entry.placement` when present and falls back to `entry.displayOffset` →
  `{ offset, scale: 1, rotation: 0 }`. No schema bump: the reader is
  backward-compatible and older readers ignore the new key (they already tolerate
  unknown entry fields). Round-trip test both directions.

### 7. Behavior changes worth calling out

- **A plain click over a folded figure now selects it** instead of starting a
  marquee. Gated on `annotationsInteractive` (same gate images use), so an active
  draw tool still draws over a figure.
- **cmd/ctrl-drag over a folded figure moves it** rather than panning — which is
  exactly what cmd-drag over an image does today, so this makes the two consistent
  rather than introducing a new rule. The canvas's `figureAt` / `movingFigure`
  branch is deleted; the overlay owns the gesture.
- **The hit target is the figure's AABB**, matching how annotations hit-test their
  box. A folded crane's bbox is noticeably larger than its silhouette, so a click
  in the empty corner of the bbox selects it. If that reads wrong in use, the
  follow-up is per-triangle picking against the cached local fills — cheap, since
  the triangles are already cached by step 2. Not in scope here.

## Affected Areas

| Area | Files |
| --- | --- |
| Placement model | `apps/web/src/engine/oristudioCpTypes.ts` (`FoldedFigurePlacement`, entry field) |
| Folded geometry | `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` (+ test) |
| Interaction substrate | `apps/web/src/cp-workspace/CpAnnotationOverlay.tsx` → `CanvasObjectOverlay.tsx`; new `cp-workspace/canvasObjects/transformableObject.ts` |
| Transform math | `apps/web/src/cp-workspace/images/cpImagePlacement.ts` → split into `annotations/annotationTransform.ts` (box math) + image-only crop/fit (+ tests) |
| Overlay views | `apps/web/src/cp-workspace/cpOverlayViewStore.ts`, `CreasePatternWebglCanvas.tsx` (`onViewChange` reports both spaces) |
| Canvas cleanup | `CreasePatternWebglCanvas.tsx` — delete `figureAt`/`movingFigure`/`scalingFigure`/`scalePivotFor`/`baseScaleFor`/`clearScalePreview`/`cancelScaling` and the 4 folded props |
| Panel wiring | `apps/web/src/components/panels/CreasePatternPanel.tsx` — overlay gets folded objects, delete `pendingScaleFigureId` + the "Scale" menu item |
| Store | `slices/creasePatternSlice.ts` (placement action, mutual-exclusive selection, history recording + request sequencing in all 8 folded actions), `slices/historySlice.ts` (entry shape, both undo/redo paths, eviction), `slices/projectSlice.ts` (`staleGeneratedFoldedFigures` call sites, close/clear), `store/workspaceStore/types.ts` |
| Handle ownership | new `apps/web/src/cp-workspace/foldedFigureHandles.ts` (+ test) |
| Folded menu gestures | `CreasePatternPanel.tsx` `FoldedFigureMenuButton` — colour inputs + alpha slider gain begin/commit scoping |
| Persistence | `apps/web/src/lib/nativeProjectFile.ts` (+ test) |
| i18n | new/removed strings via `npm run i18n:extract` + 8 locales + `i18n:stamp` |

No Rust changes. `crates/oristudio-cp` is read-only for this work — placement is
purely a display transform and the kernel's `FoldedFigureModel` keeps its Oriedita
parity semantics.

## Checklist

**Phase 1 — placement model + geometry cache** (no UI change; folded forms keep
moving via cmd/ctrl-drag, now through the placement)
- [ ] Add `FoldedFigurePlacement` and `placement` to `OristudioCpFoldedFigureEntry`; keep reading `displayOffset` on load
- [ ] Split `cpFoldedToScene` into memoized `foldedFigureLocalGeometry` + `applyFoldedPlacement`; derive `foldedFigureUserBounds` from the cached local bbox
- [ ] Delete `FoldedFigureScalePreview` and the preview parameter
- [ ] Store: `setOristudioCpFoldedFigurePlacement(id, patch)` replaces `moveOristudioCpFoldedFigure`
- [ ] `.osf` read/write + backward-compat test for `displayOffset` → `placement`
- [ ] Unit tests: placement composition (scale/rotate about the displayed centre), bbox under placement

**Phase 2 — transform-math rename + aspect-ratio rule**
- [ ] Split `cpImagePlacement.ts`: box math → `annotations/annotationTransform.ts`, crop/fit stay image-specific; `resizeImage` → `resizeAnnotationBox`, `CpImageResizeHandle` → `AnnotationResizeHandle`
- [ ] Honor `aspectLock` on edge handles; tests for corner + edge, locked + free
- [ ] Add `resizeAspectLock` resolver + tests (image default-on, text default-off, folded always)
- [ ] Wire the overlay to it — Shift now *frees* an image resize instead of locking it

**Phase 3 — kind-agnostic overlay**
- [ ] `TransformableCanvasObject` + the two adapters, with tests
- [ ] `cpOverlayViewStore` and `onViewChange` carry `{ model, user }`
- [ ] Rename `CpAnnotationOverlay` → `CanvasObjectOverlay`; project each object through its declared space; crop/edit become optional capability callbacks
- [ ] Corner-only handle set when `aspectLock === 'always'`
- [ ] Existing annotation tests still pass unchanged

**Phase 4 — folded figures join the overlay**
- [ ] Panel feeds folded objects into the overlay; move/resize/rotate write the placement
- [ ] Mutual-exclusive selection between annotation id and active folded figure id, enforced in the store
- [ ] Delete the canvas's folded drag/scale machinery and the 4 props
- [ ] Delete the "Scale" context-menu item; keep Flip / Delete / Duplicate / Wireframe / X-ray
- [ ] `i18n:extract` → translate → `i18n:stamp` → `i18n:check`

**Phase 5 — history entry carries folded figures**
- [ ] Extend `OristudioCpHistoryEntry` with `foldedFigures` + `activeFoldedFigureId`; rename `annotationsOnly` → `overlayOnly`
- [ ] Capture + restore on both undo and redo, on both the fast path and the full-document path (`historySlice.ts`)
- [ ] `recordFoldedFigureHistory(previous, label)` on the slice
- [ ] Verify the bonus fix: undoing a crease edit restores figures from `stale` back to `ready`
- [ ] Store tests: undo/redo across a mixed CP-edit + folded-edit sequence

**Phase 6 — handle refcounting**
- [ ] `foldedFigureHandles.ts` retain/release with free on 1→0; unit tests
- [ ] Wire every site: fold, duplicate, delete, history push, history eviction, `clearOristudioCpHistory`, `clearOristudioCpFoldedFigures`, document close
- [ ] Test: delete → undo → the restored figure is still kernel-editable (colour change works)
- [ ] Test: delete → undo → push `MAX_CP_HISTORY` entries → the handle is freed exactly once
- [ ] Assert the structural-sharing assumption in a test: after a colour change, the *other* figures' `renderSnapshot` objects in the new history entry are reference-identical to the previous entry's (this is what keeps history memory bounded)

**Phase 7 — route every folded action through history**
- [ ] Discrete actions record one entry each with a specific label: fold, fold-another, fold-to-case, display style, flip/side, duplicate, delete, wireframe, x-ray
- [ ] Continuous controls (3 colour inputs, alpha slider) get begin/commit scoping — one entry per drag
- [ ] Per-figure request sequencing in `updateOristudioCpFoldedFigureModel`; stale responses dropped
- [ ] Every folded action sets `dirty: true`
- [ ] Placement gestures (Phase 4) record via the same helper
- [ ] `i18n:extract` → translate → `i18n:stamp` → `i18n:check` for the new undo labels

**Phase 8 — validation**
- [ ] `cd apps/web && npx tsc --noEmit`, `npm run lint:web`, `npm run test:web`
- [ ] Browser checklist for Zach:
  - drag / resize / rotate a folded form; Shift frees an image resize and snaps a rotation
  - undo/redo each gesture
  - drag the alpha slider and a colour picker → **one** undo step each, final value correct
  - fold → recolour → delete → undo ×3 → the figure returns and its colour is still editable
  - fold a model, then close without saving → the unsaved-changes prompt appears
  - save + reopen an `.osf` with a placed folded form
  - open an `.ori` with a native camera and confirm the folded chrome sits on the figure

## Open question

**Should folded figures move into model space (option B above)?** Today a `.ori`
carrying a native Oriedita camera draws its creases through that camera but draws
its folded figure through the fixed paper mapping, so the two are already offset
from each other. Option A (this plan) preserves that behavior exactly and pays for
it with a dual-space overlay. Option B maps folded geometry through `modelToSvg`,
deletes the dual-space handling and most of the `userView` path, and probably
fixes a real placement bug — but it changes rendering for every `.ori` import and
wants its own fixtures and a parity read against Oriedita. Recommend shipping A
here and raising B separately.

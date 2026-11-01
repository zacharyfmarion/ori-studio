# Layer order dialog: building blocks, sharing with Fold, tests

Plan research for the engineering plan, 2026-10-20. Slice: the dialog's
building blocks (modal, panes, hit tests, inspector), where the engine runs,
what is shared with the Fold workspace, and the tests and gates.

**Base read.** Commit `eb4b51c54` (PR #476, `claude/fold-solver-perf`), from
the read-only snapshot. Every `path:line` below is at that commit and relative
to the repo root. The design the owner approved on 2026-10-20 wins over
`product-spec.md` where they differ (no "Layers here" list; a subject–verb–object
builder; "solutions"; CP pane left, folded pane right).

**How claims are marked.** **Verified**: I read the code. **Inferred**: follows
from code I read, not run. **Unknown**: not established. Nothing was built, run
or measured for this report.

The owner's note on the latest round ("Add a constraint should clear the
subject; right now it stays") is folded in: the builder's model below clears
the whole sentence on Add (subject, verb back to "in front of", object), which
is what `Round3.dc.html`'s `add()` → `emptySentence()` does
(`artifacts/layer-order-design/project/Round3.dc.html:1129-1138, 1230`).

---

## 0. What matters most

1. **Every visual part exists, but the dialog cannot reuse Fold's canvas
   whole.** `useCpSurface` (camera, gestures, hover probe, hit test) is
   generic and has two users already. The paper painter takes a Fold scene
   with per-face ink and X-ray. The overlay fill channel takes tints, and a
   DOM layer slot takes labels. `FoldCanvas` itself is bound to the Fold
   session and tool store, so the dialog composes the parts underneath it.
2. **The engine has the session but no web caller, and the session's wire is
   too thin for this design.** Verified gaps:
   - `import_session` / `import_check` have no TypeScript types or calls.
   - A check that fits always becomes the order shown, so a preview cannot
     be taken back.
   - The wire returns *counts* of forced pairs, not the pairs or the open
     ones.
   - Nothing returns the shown order's pairs or its scene.
   - The check limits carry no deadline in wasm.

   These are engine-slice work, but the dialog's client contract (§5) depends
   on them.
3. **The dialog needs its own worker.** Fold's engine worker is a ref-counted
   singleton, and the only way to stop a call in it is to terminate it, which
   drops every Fold state. A dedicated dialog worker, plus a second one for the
   background count, gives cancellation without touching Fold.
4. **Keys inside a modal never reach the shortcut registry.** The dispatcher
   and the app listener both stop at `data-shortcut-barrier`. Dialog-local
   undo/redo through the registry needs a small "dialog scope" addition to
   `keyboard/`. Separately, on macOS desktop the native menu's accelerators
   call `handleMenuAction` directly, with no modal check (Inferred risk:
   ⌘Z could undo the workspace behind the dialog).
5. **Sharing with Fold, now that "Layers here" is gone:**
   - Still worth doing: the stack hit index, the tint ladder with its fill
     helpers, and a `PaperPane` generic over its hit type.
   - Not needed: `LayerStackList`, since nothing uses it any more.
   - Fold's order chooser later opens this dialog in place of its "Inspect
     layer stacks" text list.
6. **The display gate already has a template.** `oracle-tests`' seeded
   Oriedita verifier checks Fold states against Oriedita. It can be pointed at
   witnesses from the session, over the fixtures in CI and over cpoogle
   locally.

---

## 1. The modal

### What exists

- **`useModalDialog(onEscape, returnFocus)`**
  (`apps/web/src/components/ui/useModalDialog.ts:64`), Verified:
  - focus settles on the `role="document"` surface, and again after a menu
    that opened the dialog lets go (`:72-82`);
  - Tab wraps (`:86-88`, `wrapTab` `:165-178`);
  - Alt+←/→ go nowhere (`:90-95`);
  - Escape is captured on `window` and stands down for fields, open layers and
    a dialog on top (`:97-103`);
  - focus that leaves is taken back (`:104-110`), and returns to the opener on
    close (`:119-124`).

  The caller marks the root `role="dialog" aria-modal="true"
  data-shortcut-barrier` itself (`FoldImportDialog.tsx:169-175`).
- **The barrier.** Verified:
  - `isShortcutBarrierTarget` / `isShortcutBarrierOpen`
    (`apps/web/src/keyboard/shortcutDispatcher.ts:142-155`) make
    `handleShortcutKeyDown` return early for any key aimed inside a barrier
    (`:157-166`);
  - `handleAppKeyDown` returns early while any barrier is open
    (`apps/web/src/lib/appKeyboard.ts:66-76`). No workspace key reaches
    Edit, Diagram or Pose behind it, which is what spec §7.4 needs for Pose.
- **Root mounting.** Overlays mount in `App.tsx`, in document order, which is
  their stacking order (`apps/web/src/App.tsx:172-219`), each in an
  `OverlayErrorBoundary`. Verified.
  - The References browser, Diagram's From Fold… and Fold's Import CP come
    first, so Settings or Export opened from the native menu land on top
    (`:177-191`).
  - Code that is not in the main chunk loads through a gateway:
    `lazyModule` (`apps/web/src/workspaces/foldGateway.ts:22`) and
    `FoldGate pending="none" onFailed` (`components/fold/FoldGate.tsx:47-60`),
    as `DiagramFoldModal` does (`components/diagram/DiagramFoldModal.tsx:15-29`).
- **The newer frame.**
  - Copy one: `FoldImportDialog.module.css`:
    - backdrop `:7-19`;
    - surface `:21-32`;
    - 36px bar on `--bg-secondary` `:38-47`;
    - title `:49-57`;
    - footer on `--bg-elevated` `:79-87`;
    - full screen at `max-width: 720px` `:103-115`.
  - Copy two: `DiagramReferencesBrowser.module.css`, with the same parts plus
    a rail and phone list/detail screens. It is rendered by `PullBrowserFrame`
    (`components/diagram/DiagramReferencesBrowser.tsx:129-…`).

  Verified: there is no shared frame component. The two dialogs copy the CSS.
- **Opening state** lives in small stores. One example is
  `useFoldImportUiStore` (`fold/io/foldImportUiStore.ts`); its opening carries
  `returnFocus`, which `FoldImportModal` keys the dialog on
  (`FoldImportDialog.tsx:25-30`). Verified.

### What is missing

- **An opening store and a mount for the dialog.**
- **A frame sized for two canvases and a 304px column.** The References
  browser is the nearest, at `min(1180px,100%) × min(860px,100%)`.
- **A phone layout.** Two panes plus an inspector do not fit at 375px.
- **A decision on which chunk the dialog's code loads in.**

### Proposal

- **`apps/web/src/layer-order/layerOrderDialogStore.ts`**, in the main chunk
  so every host can open the dialog without loading it:

  ```ts
  export type LayerOrderSurface = 'edit_figure' | 'edit_pattern' | 'diagram_step' | 'pose';
  export interface LayerOrderOpening {
    id: number;                      // keys the dialog, as FoldImportModal keys on opening.id
    surface: LayerOrderSurface;      // analytics + which workspace must stay on screen
    title: string;                   // the figure's or step's name, for the header
    source: FoldImportSource;        // the crease pattern as the engine imports it (engine slice decides Edit's rules)
    startSide: 'front' | 'back';
    style: PaperStyle;               // how the host draws the folded figure (spec §6.2)
    saved: SavedLayerOrder | null;   // constraints + witness by paper points (save slice owns the shape)
    returnFocus: HTMLElement | null; // dialogOpener() at open time (useModalDialog.ts:21)
    apply: (result: LayerOrderResult) => void; // host commits as one undo step
  }
  ```

- **`App.tsx`:** mount `<OverlayErrorBoundary id="layer-order"><LayerOrderModal
  /></OverlayErrorBoundary>` after `fold-import` and before `help`, so Settings
  and Export from the native menu still land on top. Like `DiagramFoldModal`,
  `LayerOrderModal` renders only while the opening's workspace is the active
  one (`useLayoutStore`).
- **Its own chunk:** `workspaces/layerOrderGateway.ts` (`lazyModule`), with a
  `LayerOrderGate pending="none"` that closes the opening and toasts on
  failure (the `DiagramFoldModal` pattern). Not inside Fold's chunk: Edit users
  who never open Fold should not download the Fold panel. Vite splits the
  modules the two chunks share (`fold/canvas/*`, the wire types).
- **`components/ui/ModalFrame.tsx` + `ModalFrame.module.css`.** The newer
  frame as a component:
  - parts: backdrop, surface, bar (`lead`, title, `tools`, close), body,
    footer;
  - `size: 'form' | 'browser' | 'workspace'` as a data attribute, never a
    class another screen writes;
  - full screen below 720px.

  The dialog is its third user. `FoldImportDialog` moves onto it in a
  no-visual-change commit, proved by computed styles before and after.
  `PullBrowserFrame` can follow in its own PR, since its rail and phone
  screens are References' own.

  Sizes:
  - `form` is `min(560px,100%)` × max `min(760px,100%)`;
  - `browser` is `min(1180px,100%)` × `min(860px,100%)`;
  - `workspace` is new, proposed as `min(1320px,100%)` × `min(880px,100%)`.
    That is an owner or design call.
- **The dialog body** is a grid `minmax(0,1fr) minmax(0,1fr) 304px`: the CP
  pane, the folded pane, then the inspector column with
  `border-left: 1px solid var(--border-subtle)`. The pane split's divider
  stays in the dialog's module, as Fold's does
  (`components/fold/canvas/FoldCanvas.module.css:30-45`).
- **Phone and touch (proposal, owner to confirm).** Below 720px the frame is
  full screen, and the body becomes one column:
  - one pane at a time, switched by `PaneToggle`
    (`components/ui/PaneToggle.tsx:33`) in the pane's bar, as Fold's phone
    canvas does;
  - the inspector under it, scrolling, capped at about 45% of the height;
  - the footer pinned.

  Under a coarse pointer every control is already 44px, through
  Button/IconButton (ui-brief §2). The builder's face slots and the list rows
  need `min-height: var(--touch-target)` in their own modules.

  Hover-only feedback needs a tap equivalent:
  - the "C · 3 faces to choose from" hint shows for the face just tapped;
  - a list row's faces light while the row is focused or pressed.

  `useCpSurface` already shows the mark under a finger on touch-down
  (`cp-workspace/surface/useCpSurface.ts:241-245`).

### Size, risks, tests

- **Size:** S for the store, mount and gateway; M for `ModalFrame` with the
  Fold import move.
- **Risks:**
  - A workspace switch while the dialog is open (the native menu can do one)
    must close it, or it stays mounted over the wrong workspace (Inferred).
    The `activeWorkspace` guard handles it.
  - The frame move must change nothing on screen. Two copies of the same CSS
    already exist, so drift between them is likely (Inferred).
- **Tests:**
  - A vitest component test in the `FoldImportDialog.test.tsx` style: open
    from the store, Escape closes, the backdrop closes, focus returns, and the
    dialog renders nothing while another workspace is active.
  - The `globalStylesheets.test.ts` ratchet and `liveSelectors.test.ts`.
  - A computed-style proof for the Fold import move.

---

## 2. The two panes

### What exists (all Verified unless marked)

- **`useCpSurface<Hit>(options)`** (`cp-workspace/surface/useCpSurface.ts:219`).
  - It owns the renderer's lifecycle, context loss, DPR and resize, first
    fit and refit on `framingKey` (`:457-460`), `keepInViewKey`, `inset`, and
    pan, pinch and wheel.
  - It tells a click from a drag (`bindCpSurfaceInput`, `:436-444`) and runs
    the hover probe through `hitTest` / `sameHit` (`:405-434`).
  - Coarse-pointer hit floors: `:243-245`.
  - Camera controls: zoom in and out, percent, fit, frame bounds
    (`:505-546`).
  - It draws nothing itself: the caller uploads channels keyed on
    `rendererGeneration`.
  - Users today: `ReferencesCpView.tsx` and `FoldPane.tsx`.
- **`FoldPane`** (`components/fold/canvas/FoldPane.tsx:134`), about 160 lines
  over `useCpSurface`:
  - a `PaperScene` through `paperSceneToFoldedGeometry` on the folded channel
    (`:207-219`);
  - optional CP strokes on the crease channel (`:222-228`);
  - `tint` and the tool's `fills` on the overlay fill channel through
    `setDiagnosticFills` (`:239-244`);
  - points and preview strokes (`:245-251`);
  - the `layers(view)` DOM slot (`:291`), focus on press, and held-modifier
    sync (`:265-282`).

  Fold-specific parts:
  - `FoldHit` / `sameFoldHit`;
  - `FOLD_UNITS_PER_CP_UNIT` radius scaling (`:185-188`);
  - posed-scene playback (`:162-166`, `:213-218`);
  - `styles.pane` from `FoldCanvas.module.css`.
- **Coordinates.** The pane's frame is Fold units mapped to user space by
  `foldUnitToUser` (`fold/canvas/foldCanvasGeometry.ts:41`). The folded pane
  shifts by `foldedDisplayOffset` (`fold/canvas/foldPaneScenes.ts:79-87`), so
  a turn-over turns in place about the sheet's middle.
- **The painter.**
  - `foldedPaneScene(scene, display, offset, spread)`
    (`foldPaneScenes.ts:133`) produces `foldedFlatPaperScene(kernel, options)`
    (`cp-workspace/folded/foldedFlatScene.ts:127`, options `:100-117`;
    `markHidden` drops buried faces).
  - Its output goes through `paperSceneToFoldedGeometry(scene, style, ink)`
    (`cp-workspace/adapters/cpFoldedToScene.ts:850`).
  - The ink is `FoldedSceneInk { policy, faceAlpha, faces: Map<face,
    FoldedFaceInk{tint, alpha}> }` (`:715-742`).
  - **X-ray** is `faceAlpha < 1`. The painter then draws every buried piece
    (`foldedSceneLocalGeometry`, `:784-847`, "opaque" test at `:798`).
  - **Per-face ink tints only what is painted.** Lighting a face including its
    hidden parts needs the overlay fill channel instead
    (`design/fold-share.md` §4.1).
- **The scene's cells are stable and convex.**
  - `FoldScene.subfaces` are the cells of the layer-order overlay, in overlay
    order, each with `faces_top_to_bottom` (`crates/oristudio-fold/src/scene.rs:16-19`,
    built at `:286-309`).
  - The cell index is therefore a stable spot id for one import, across
    orders. Inferred: same problem, same overlay.
  - A turned-over scene mirrors the polygons and reverses every stack
    (`scene.rs:301-304`, test `:520-527`).
  - **Stacks hold scene face positions, not `FaceId`s** (`face_position(id)`,
    `scene.rs:296-300`). `lineage[k].id` maps a position to a `FaceId`, which
    Fold already does (`fold/canvas/foldPaneOverlays.ts:219-224`).
  - Fold faces are convex: Import CP refuses `import_non_convex_face`
    (`fold/engine/foldEngineIoWire.ts:144`).
  - Inferred: overlay cells are convex too. Fold's own picking assumes it
    (`insideConvex` in `foldPicking.ts:285-294`), as does the fold-workspace
    plan's D8.
- **Channels and draw order** (`cp-workspace/renderer/reglRenderer.ts:369-494`):
  1. clear;
  2. `sheetFill` (`:383-385`, under everything; only References uses it,
     `ReferencesCpView.tsx:482,499`);
  3. grid;
  4. crease strokes (`:415`);
  5. points;
  6. folded fills and strokes (`:436-442`);
  7. `diagnosticFills`, the "overlay fill channel" (`:457-459`);
  8. markers;
  9. `preview` strokes (`:478-480`, on top);
  10. overlay points.

  The interface is at `cp-workspace/renderer/CpRenderer.ts:81,92,97,105`.
- **No text program.** `cp-workspace/renderer/programs/` has fill, stroke,
  point, marker, wedge, image, region and shadow, and nothing for text. Labels
  are therefore DOM or SVG over the canvas, as Fold's arrows and letters are
  (`components/fold/canvas/FoldActionLayer.tsx:151`, `.layer` in
  `FoldCanvas.module.css:55-60`, through `CpOverlayView`, whose origin, ex and
  ey are in CSS px, `cp-workspace/CreasePatternWebglCanvas.tsx:184-188`).
- **The CP pane as Edit draws one.**
  `useFoldCreasePatternStrokes(lines, element, themeKey)`
  (`fold/canvas/useFoldCreasePatternStrokes.ts:45`) over `creasePatternPaneLines(scene, …)`
  (`fold/canvas/foldCreasePatternLines.ts:58`) draws the scene's sheet-space
  `creases[]` in Edit's line style and width.
- **Theme inks.** `useFoldCanvasInks(element, themeKey)`
  (`fold/canvas/useFoldCanvasInks.ts:34`) reads `--accent-primary`,
  `--status-danger` and `--bg-primary`, which satisfies "theme tokens only".
- **Per-pane toolbars.** `ViewportToolbar` (`components/panels/ViewportToolbar.tsx:189-288`)
  takes zoom in and out, percent, Fit, extra `groups`, and `tone`. Fold drives
  both panes from one bar (`FoldCanvas.tsx:145-157`). The design gives each
  pane its own bar, which is simpler: one `ViewportToolbar` per pane, bound to
  that pane's `controls`.

### What is missing for this design

1. **A pane component that is not Fold's.** `FoldPane` assumes `FoldHit` and
   Fold's playback.
2. **The CP pane's tints.** Nothing draws them:
   - a faint tint on pickable faces, or on the subject's open faces;
   - the subject at 0.50, the object at 0.26, hover, danger;
   - outline rings around those faces.
3. **The folded pane's tints:**
   - pickable or open-object spots, faint;
   - the subject's spots;
   - changed spots, flashed;
   - open spots, behind a switch;
   - a hovered or clashing face *including its hidden parts*.
4. **Letter labels on both panes**, with collision-avoiding placement. On the
   folded pane a label goes on the largest spot where the face is on top, or a
   quieter "under" chip when the face is wholly hidden (prototype
   `Round3.dc.html:1360-1379`).
5. **The back view.** The engine has to hand over a turned-over scene, or the
   client has to mirror it (§2.5).
6. **An X-ray alpha for the dialog.** Edit's flat X-ray is the kernel's baked
   `Transparent3` pass, not a painter alpha. The painter's 3D constant is 0.45
   (`cp-workspace/folded/folded3dStyle.ts:41`), which saturates on a
   250-layer stack (Inferred).

### Proposal

**2.1 `cp-workspace/surface/PaperPane.tsx`** (+ `PaperPane.module.css`),
generic over `Hit`. It is `FoldPane` minus Fold.

```ts
export interface PaperPaneProps<Hit> {
  paper?: { scene: PaperScene; style: PaperStyle; ink?: FoldedSceneInk } | null; // folded channel
  creases?: { strokes: StrokeGeometry; widthCss: number } | null;             // crease channel
  underFills?: FillGeometry | null;   // sheetFill: under the creases (CP tints that must not veil a crease)
  fills?: FillGeometry | null;        // overlay fill channel, above the paper
  outlines?: StrokeGeometry | null;   // preview channel: rings
  points?: PointGeometry | null;
  modelToSvg: (p: Point) => Point; contentBounds: UserBounds | null; framingKey: string;
  keepInViewKey?: string | null; inset?: CpSurfaceInset | null;
  radiusScale?: number;               // FOLD_UNITS_PER_CP_UNIT for Fold-unit scenes
  hitTest: (at: Point, radii: CpSurfaceHitRadii) => Hit | null; sameHit: (a: Hit, b: Hit) => boolean;
  onPick: (hit: Hit | null) => void; onHover?: (hit: Hit | null) => void;
  layers?: (view: CpOverlayView) => ReactNode;
  posedScene?: FoldPosedSceneSource;  // optional; Fold passes it, the dialog doesn't
  wheelGesture: WheelGesturePreference; snapRadius: number;
  onZoomPercentChange?: (p: number) => void; onActivate?: () => void;
  ariaLabel: string; testId: string;
}
```

- `FoldPane` becomes a thin specialisation: `FoldHit`, `radiusScale`,
  playback, and its tool overlay mapped into `fills` / `outlines` / `points`.
- Everything here is a channel. No prop carries meaning, which is the guard
  against over-abstraction.
- **Do it as the first, no-change commit of the panes PR.** The dialog is
  the second user, which is the right time ("never extract ahead of the second
  user", fold-share §4.4).
- `FoldPane` sits in open PRs #475 and #476. The dialog's branch stacks on
  #476, so the move rebases rather than conflicts (Inferred).

**2.2 `components/layer-order/LayerOrderPanes.tsx`** composes two
`PaperPane<LayerOrderHit>`s and their `ViewportToolbar`s.

```ts
type LayerOrderHit =
  | { pane: 'crease-pattern'; face: number | null }                // scene face position
  | { pane: 'folded'; cell: number | null; face: number | null };  // top face from the side shown
```

- `sameHit` compares `(pane, face)`, so a move across one face re-renders
  nothing, as `sameFoldHit` intends (`fold/canvas/foldPicking.ts:143-147`).
- **CP pane:**
  - `creases` from `useFoldCreasePatternStrokes(creasePatternPaneLines(scene, …))`;
  - `underFills` for the faint "you can pick these" tint;
  - `fills` for subject, object, hover and danger;
  - `outlines` for the rings;
  - `modelToSvg = foldUnitToUser`.
- **Folded pane:**
  - `paper` = `foldedPaneScene(scene[side], display, foldedDisplayOffset(...))`,
    with `ink = { policy: PAPER_STYLE_POLICIES[hostPolicy], faceAlpha: xray ? xrayAlpha(maxDepth) : 1 }`;
  - `fills` from the tint model;
  - `outlines` for rings around whole faces, hidden parts included.

  `hostPolicy` is `folded-flat` for Edit and the Diagram's policy for a step;
  the hosts slice confirms which.
- **X-ray alpha:** `xrayAlpha(depth) = 1 − 0.4^(1/depth)`, so the deepest
  stack reaches about 60%. That mirrors the "about 6% a face over 10–14
  layers" Edit comment (ui-brief §8; Inferred). It needs an owner look on
  kabuto and on iguana-c0.

**2.3 `layer-order/canvas/layerOrderTints.ts`** (pure). The design's states
become semantic tint lists, which the shared helpers (§3, §6) then turn into
geometry:

```ts
type TintRole = 'faint' | 'hover' | 'object' | 'subject' | 'changed' | 'danger';
interface PaneTints { under?: number[] /* faces, CP only */; faces: { face: number; role: TintRole }[]; cells: { cell: number; role: TintRole }[]; rings: { face: number; role: 'accent' | 'danger'; weight: 'strong' | 'light' }[] }
export function layerOrderTints(model: LayerOrderView): { cp: PaneTints; folded: PaneTints };
```

- It mirrors the prototype's precedence: each spot carries one tint at most,
  and a stronger state wins (`Round3.dc.html:1312-1356`).
- Alphas come from the shared ladder in §6.2: faint 0.16, hover 0.26, picked
  or changed 0.42, subject 0.50, danger 0.30 and 0.42 on hover.
- Colours are `accent` and `danger` from `useFoldCanvasInks` only.
- **The changed-spots flash** is two pulses of the `changed` cells' alpha
  over about 600 ms, by re-uploading `fills`, which is cheap. Under
  `prefers-reduced-motion`, one steady tint for about 1 s.
- **Open spots** is a faint tint on open cells, behind its switch. The open
  cells come from the engine (§5), because deciding them needs the forced
  relation.

**2.4 Labels: `layer-order/canvas/faceLabelPlacement.ts`** (pure) and
`components/layer-order/FaceLabelLayer.tsx`, a DOM layer in the pane's
`layers` slot.

- Placement in CSS px through `CpOverlayView`.
- Each chip is a `LayerOrderFaceTag` with `tone: 'accent' | 'quiet' | 'danger'`
  and `under: boolean`, styled in its own module from theme tokens only.
  `pointer-events: none` and `aria-hidden`; the inspector carries the
  accessible text.
- **CP pane:** each face's anchor is the centroid of its sheet polygon, which
  lies inside because the face is convex.
- **Folded pane:** candidate anchors are the centroids of the cells where the
  face is on top from the side shown, largest first. A wholly hidden face
  gets an "under" chip at its centre, or over one of its cells. A greedy
  pass keeps chips apart (prototype `:1360-1379`).
- Re-placement runs on every camera change. `PaperPane` re-renders the layer
  on `onViewChange`, as `FoldPane` does (`:160, 198, 291`). It only runs for
  the faces that carry labels (subject, open objects, a hovered constraint's
  two, clashing faces), so the count is small. Large figures are the
  exception (risks).
- **Face letters** are assigned once per opening, in the crease pattern's
  reading order: rows by centroid y, then x, then A–Z, AA… (prototype
  `labelOf` / `decode`, `Round3.dc.html:602-618`). Pure:
  `layer-order/model/faceLetters.ts`.

**2.5 Back and front.**

- The CP pane never mirrors. The prototype mirrors only the folded pane
  (`Round3.dc.html:1485`), and Fold's CP pane is "front up"
  (`FoldCanvas.tsx:389-392`).
- The folded pane shows `scene[side]`. Recommended: the engine returns both
  scenes, or the stacks per side (§5). The turned-over scene already mirrors
  the polygons, reverses the stacks and flips `front_up` (`scene.rs:301-304`),
  and `foldedDisplayOffset` turns it in place.
- Mirroring on the client would mean redoing what `turn_over().scene()`
  does: the order of painting, `front_up`, and the stack direction. That is
  needless duplication.
- Constraints are stored front-relative. The model converts "S in front of
  O, seen from the back" as `sentenceCons` does
  (`Round3.dc.html:761-766`).

### Size, risks, tests

- **Size:** L. `PaperPane` M, the panes and switches M, tints and the flash
  S–M, labels M.
- **Risks:**
  - `PaperPane` is the riskiest extraction: playback, open PRs, and Fold's
    camera tests (`FoldCanvas.camera.test.tsx`).
  - A label storm. On iguana-c0 a subject can have dozens of open faces
    (Unknown). Placement must cap or fall back to labelling only the hovered
    face. That is an owner or design question.
  - The X-ray look on deep stacks (Inferred).
  - Re-uploading per-face ink rebuilds the painter's geometry cache key
    (`cpFoldedToScene.ts:794-797`). Hover tints therefore go through `fills`,
    never through `ink.faces`, or every hover repaints the paper (Inferred).
- **Tests:**
  - Unit tests for `layerOrderTints`, covering precedence and the
    side-aware top, and for `faceLabelPlacement`, covering no overlap, the
    hidden-face fallback and mirroring;
  - `faceLetters`;
  - `xrayAlpha`;
  - `PaperPane` tests mirroring `FoldCanvas.test.tsx` and its camera test
    (mount, fit, aria-labels);
  - Fold's existing canvas tests must pass unchanged through the extraction.
  - Pixels are checked only in a real-frame browser lane (§7). The comment
    at `scripts/folded-grid-screenshot.mjs:4-8` says the agent pane draws no
    WebGL frames.

---

## 3. Hit tests

### What exists (Verified)

- **Fold's private stack lookup.**
  - `IndexedSubface { polygon, box, stack }` (`fold/canvas/foldPicking.ts:180-184`)
    is built in `foldPickIndex` (`:346-350`).
  - `stackAt(subfaces, p, epsilon)` is a linear scan with a bbox reject and
    `insideConvex` (`:285-294`).
  - Exposed through `foldStackAt` (`:498-500`) and `topSheetPointAt`
    (`:507-513`).
  - It returns the stack and drops the cell index.
- **`sheetToScene(scene, sheet)`** (`:272-282`) scans the faces' sheet
  outlines (`faces[f].points` → `sheet_points`) with `insideConvex` and maps
  through `face_transforms`. That is exactly "which face holds this paper
  point", with the face thrown away.
- **Users outside picking:** `foldPaneOverlays.ts` (moving and target tints
  scan `index.subfaces`), `foldStepLetters.ts`, `foldAlongLine.ts`,
  `useFoldCanvasVerbs.ts`, the step builders, and `diagram/pictures/paintStepDiagram.ts`
  (grep of `foldStackAt|topSheetPointAt|sheetToScene`).
- **Budget.** D14 tier 1 is ≤ 4 ms per move (`implementation-plans/fold-workspace.md:797`).
  The hover probe is coalesced to one per animation frame
  (`cp-workspace/surface/cpSurfaceInput.ts:67-80`). `LineHitIndex` is a
  uniform-grid precedent (`cp-workspace/picking/lineHitIndex.ts:17-50`).

### What is missing

- The cell id, which is the spot's identity, from the stack lookup.
- A face-at-paper-point test that returns the face. It serves the CP pane's
  pick, and resolving a saved paper point to a face after a reopen.
- A measurement on the largest figure. iguana-c0 has 850 faces and 120,825
  pairs; its cell count is **Unknown**.

### Proposal: `cp-workspace/picking/stackHitIndex.ts`

Pure: no React, no store.

```ts
export interface StackCell { polygon: readonly Point[]; faces_top_to_bottom: readonly number[] }
export interface StackHitIndex { readonly cells: readonly { polygon: Point[]; box: Bounds; stack: readonly number[] }[]; /* + optional grid */ }
export function indexStacks(cells: readonly StackCell[], options?: { grid?: 'auto' | 'never' }): StackHitIndex;
/** The cell under p and its faces, top first; null off the paper. */
export function stackAt(index: StackHitIndex, p: Point, epsilon = 0): { cell: number; faces: readonly number[] } | null;
/** The face whose sheet outline holds a sheet point: the CP pane's pick and a saved paper point's face. */
export function faceAtSheetPoint(scene: Pick<OristudioCpFoldedPaperScene, 'faces' | 'sheet_points'>, p: Point, epsilon = 1e-7): number | null;
export function topFaceAt(index: StackHitIndex, p: Point, side: 'front' | 'back'): { cell: number; face: number } | null;
```

- **Convexity:** keep `insideConvex` and document "convex cells". Fold scenes
  are convex, and the dialog hit-tests the Fold scene, never Oriedita's. That
  is what keeps pointer moves out of the face bridge (fold-share §4.2-A).
- **Grid:** above about 2,000 cells, bin the boxes into a uniform grid sized
  like `LineHitIndex`'s. Below that, a linear scan with a bbox reject is
  enough (Inferred).
- **Fold moves onto it in its own commit.** `foldPickIndex.subfaces` becomes
  a `StackHitIndex`, and `foldStackAt` / `topSheetPointAt` keep their
  signatures. `sheetToScene` calls `faceAtSheetPoint` and then maps through
  `face_transforms`.
- **`side`.** The scene's stacks are already top-first for the viewer. The
  back view is a different scene, so a top-face query needs no reversal.
  `topFaceAt` takes `side` only so that the client's own patched stacks (§5)
  stay unambiguous. Drop the argument if the engine always ships per-side
  stacks.

### Size, risks, tests

- **Size:** S, plus S for moving Fold onto it.
- **Risks:**
  - An unknown cell count on deep figures.
  - A pure lookup that misses on a shared cell edge without `epsilon`.
    Fold's `topSheetPointAt` uses `1e-9` (`:508`).
- **Tests:**
  - `stackHitIndex.test.ts`: inside, edge, off-paper, grid and linear agree,
    and the cell id is returned.
  - Fold's `foldPicking.test.ts` unchanged.
  - `stackHitIndex.wasm.test.ts`: import iguana-c0 in process (the
    `foldEngineIo.wasm.test.ts` pattern), log the cell count and the
    p50/p99 of 10,000 random `stackAt` + `faceAtSheetPoint` calls. Assert
    correctness against a brute force, and only a loose ceiling (20 ms)
    rather than the 4 ms budget, so CI does not flake. The 4 ms figure is
    reported in the PR. The memory note on flaky timing tests applies.

---

## 4. The inspector

### What exists (Verified)

- **Controls.**
  - `Button` (`components/ui/Button.tsx:11-45`), `sm` at 28px.
  - `IconButton` (`components/ui/IconButton.tsx:24-90`): `title` gives the
    tooltip and the accessible name, and a disabled button keeps its tooltip.
  - `Menu` parts over Radix DropdownMenu (`components/ui/Menu.tsx:1-125`).
  - `Select` / `SelectTrigger` (`components/ui/Select.tsx:10-24`) wear the
    global, **shared** `select-trigger` block, which the export dialogs
    restyle (`implementation-plans/scoped-css.md:201-205`).
  - `Notice`, `Tooltip`, `SegmentedControl`, `Toggle`, `PaneToggle`.
- **Icons.** Lucide `Trash2` is already Delete (`components/ui/steps/StepCard.tsx:193`,
  `components/diagram/DiagramLayers.tsx:67`). `Undo2` / `Redo2` appear in
  `TouchHistoryButtons.tsx` and `CanvasHistoryPills.tsx`. `ChevronLeft` and
  `ChevronRight` are the pager (ui-brief §3).
- **Pager precedent.** The Diagram's "Layer order ‹ n of m ›" chevrons refuse
  with `aria-disabled` and a reason tooltip
  (`components/diagram/DiagramStepPose.tsx:211`; ui-brief §5.2).
- **Workspace history.** `TouchHistoryButtons` dispatch `handleMenuAction('edit.undo')`
  (`components/ui/TouchHistoryButtons.tsx:15-40`). That is the *workspace's*
  history and the wrong one here.
- **Keyboard.**
  - The registry's conditional scopes are
    `CONDITIONAL_SHORTCUT_SCOPES` (`keyboard/shortcuts.ts:59-64`) and
    `registerConditionalScopeExecutor` (`keyboard/shortcutRuntime.ts:101-112`).
  - Keys aimed inside a barrier dialog are dropped before any scope resolves
    (`shortcutDispatcher.ts:160-166`; `appKeyboard.ts:66-76`).
  - Dialogs handle their own keys today with local listeners:
    `PullBrowserFrame`'s `onKeyDown` (`DiagramReferencesBrowser.tsx:181-199`),
    and `SettingsModal` and `CommandDialogModal` window listeners
    (`SettingsModal.tsx:737-819`, `CommandDialogModal.tsx:68-76`).
- **Native menu.** On macOS desktop each item's `action` calls
  `handleMenuAction(item.id)` with the item's accelerator
  (`menus/nativeMenu.ts:101-111`). I found no barrier check in
  `commands/menuActions.ts` or the menus (grep). **Inferred risk:** ⌘Z or
  Edit ▸ Undo while the dialog is open undoes the host workspace. This
  already applies to every modal and is not new, but it is worse here,
  because the dialog has an undo of its own.
- **Analytics.** `ANALYTICS_EVENTS` (`analytics/events.ts:1212`),
  `bucketCount` (`:2073`), `track` (`analytics/runtime`). Per-feature
  trackers follow the `analytics/trackFoldIo.ts` pattern.
- **i18n.** `t('dialogs:<key>', 'English')` (`apps/web/CLAUDE.md`,
  `FoldImportDialog.tsx:47-76`), then `npm run i18n:extract`, the 8 locales
  and `i18n:check`.

### What is missing

Every inspector component. A local history. A way for dialog chords to use
the registry. The builder's model. Analytics for this feature.

### Proposal

**4.1 The model: `layer-order/model/`.** Pure, React-free and store-free:
the "action catalog" layer AGENTS.md asks for.

```ts
// layerOrderModel.ts
export interface LayerConstraint { id: number; upper: number; lower: number; subject: number; object: number } // scene face positions; front-relative
export interface LayerOrderSentence { subject: number | null; verb: 'front' | 'behind'; object: number | null; active: 'subject' | 'object' }
export interface LayerOrderState {
  constraints: readonly LayerConstraint[];
  history: LayerOrderHistory;            // local; see below
  sentence: LayerOrderSentence;
  side: 'front' | 'back'; xray: boolean; openSpots: boolean;
  open: OpenPairs;                        // from the engine after every commit (§5)
  shown: StackSet; preview: PreviewState; // shown order; preview of the complete sentence
  status: { solutions: CountState; index: number | null };
  hover: { pane: number | null; constraint: number | null; slot: 'subject' | 'object' | null };
}
export function pickableSubjects(open: OpenPairs): ReadonlySet<number>;         // ≥ 1 open face
export function openObjects(open: OpenPairs, subject: number): readonly number[]; // sorted by letter
export function sentencePair(s: LayerOrderSentence, side: Side): [upper: number, lower: number]; // front-relative
export function hintLine(state, letters): HintLine;   // { key, values, tone: 'quiet' | 'danger' } → i18n at render
export function layerOrderReducer(state, action): LayerOrderState;
// actions: pickFace{face, pane} · setVerb · clearSentence · previewed · added · remove{id} · loadSubject{id}
//          undo · redo · clearAll · setSide · setXray · setOpenSpots · stepSolution{delta} · hover*
```

- **Picking.** A face is pickable for a slot only if the model allows it: a
  subject must have at least one open face, and an object must be one of the
  subject's open faces. A click on anything else is inert: no hover, no
  pick.
- **Add** fires the commit, and on success:
  - pushes the constraint and a history entry;
  - **clears the sentence**: subject, verb back to `front`, object, slot
    back to `subject` (Round3 `add()`);
  - starts the changed-spots flash.

  A sentence the preview found unfit leaves Add `aria-disabled`, with the
  reason as the hint line and as the button's tooltip.
- **A list row click** runs `loadSubject`: subject = the row's subject,
  `active: 'object'`. Hovering a row lights its two faces and shows their
  labels.
- **`layerOrderHistory.ts`:** `{ past, present, future }` of
  `{ constraints, witness }` snapshots. Add, remove and Clear all are entries.
  Previews and browsing are not; browsing adds nothing (spec §6.6). Undo
  restores the constraints and asks the engine to show the snapshot's
  witness (§5 `prefer`). It never touches `handleMenuAction`.

**4.2 Binding: `layer-order/useLayerOrderDialog.ts`.** This is the hook the
dialog's composition site calls, the `useViewportSurface` shape AGENTS.md
points to. It owns the reducer, the engine client (§5), and the latest-wins
preview channel. It returns state plus a small verb object. The dialog
component composes; it holds no effects of its own beyond mounting.

**4.3 Components** under `components/layer-order/`, each with a CSS module:

- **`LayerOrderDialog.tsx`**, the composition site: `ModalFrame` + panes +
  inspector + footer (Cancel, Apply).
- **`LayerOrderStatus.tsx`:**
  - "N solutions" (`dialogs:layerOrder.status.solutions`, pluralised);
  - a `Tooltip` with the layer-order count ("12 layer orders fit; 4 differ
    only in hidden layers");
  - ‹ n of N › as `IconButton sm` with `ChevronLeft` / `ChevronRight`,
    refusing with `aria-disabled` and a reason (the Diagram pager idiom);
  - reads "at least N" when the count is inexact;
  - absent on figures where the count does not run.
- **`LayerOrderSentenceBuilder.tsx`:**
  - two **face slots**: buttons with `aria-pressed` for the active slot,
    showing a `LayerOrderFaceTag` or a placeholder, at
    `min-height: var(--touch-target)` under a coarse pointer;
  - the **verb menu**: a DropdownMenu with a `Button size="sm"
    variant="secondary"` trigger and `ChevronDown`, holding two `MenuItem`s
    with a check in the leading slot. Use **Menu, not Select**: Select wears
    the shared `select-trigger` block (no new rules allowed there), and a
    menu item's `onFocus` / `onPointerEnter` can preview the verb pointed at,
    as Round3 does (`:1264-1275`);
  - the **hint line**: one line, its height always reserved (owner rule 7),
    `role="status" aria-live="polite"`, in the danger tone only for a
    blocking reason (can't fit, nothing left to choose, couldn't check in
    time);
  - **Clear** (ghost `sm`) and **Add constraint** (primary `sm`).
- **`LayerOrderConstraintList.tsx`:**
  - a header with undo and redo (`IconButton sm`, `Undo2` / `Redo2` at 14px)
    and **Clear all** (ghost `sm`);
  - `<ul role="list">` rows, each a row button with the sentence (subject,
    verb, object chips, read from the side shown) and a trash `IconButton`
    (`Trash2` 14px, `aria-label` "Remove C in front of D");
  - `data-clash` on rows in a clash, in danger ink, never dashed.
- **`LayerOrderFaceTag.tsx`:** the chip the slots, rows and pane labels
  share, with `tone` and `under` as props per the styling rules.

**4.4 Keyboard: a dialog scope in `keyboard/`** (recommended).

- Add `keyboard/dialogShortcuts.ts` with
  `useDialogShortcutScope(scope, rootRef, executor)`. It installs one
  window capture `keydown` listener, the `useModalDialog` shape.
- The listener acts only while its root is `isTopmostDialog`. It resolves the
  chord through the same `SHORTCUT_DEFINITIONS` and user overrides, filtered
  to `scope: 'layer-order'`. It respects `isShortcutEditingTarget` and
  `isOpenLayerTarget`, and claims a chord only when the executor returns
  true.
- Implement it as an option on `handleShortcutKeyDown`
  (`{ insideBarrier: root }`) so there is one resolution path ("one
  predicate per question").
- Definitions:
  - `layerOrder.undo` (Mod+Z);
  - `layerOrder.redo` (Mod+Shift+Z, Mod+Y);
  - optional: `layerOrder.flipSide`.

  They then appear in Settings ▸ Shortcuts and can be rebound.
- Escape stays `useModalDialog`'s. Enter, Space and the arrows stay native
  to the focused control: menus, buttons, the list.
- **Fallback (S):** a `PullBrowserFrame`-style `onKeyDown` on the document.
  It is quicker, but it is exactly the "keydown listener on a container"
  that AGENTS.md steers away from.
- **Desktop.** Guard `handleMenuAction` for `edit.undo` / `edit.redo` while
  a barrier dialog is open: either refuse, or route to a registered modal
  history (`registerModalHistory(owner)`). This is an owner call, and it
  needs a desktop check either way (risks).

**4.5 i18n.**

- Keys: `dialogs:layerOrder.*`.
- **Sentences must be whole per locale.** "C in front of D" becomes
  `t('dialogs:layerOrder.sentence.front', '{{subject}} in front of {{object}}')`;
  no concatenated verb.
- **The builder's visual order is a locale question.** In ja and ko the verb
  comes last. Proposal: the slot order comes from a translated template,
  `dialogs:layerOrder.builder.order` = `"{{subject}} {{verb}} {{object}}"`,
  parsed into slot positions. It is open, because it changes the layout.
- `npm run i18n:extract`, translations for the 8 locales, `i18n:stamp`,
  `i18n:check`.

**4.6 Analytics: `analytics/trackLayerOrder.ts`.** Spec §10, updated to the
design:

- `layer order dialog opened`: `surface`, `face_count_bucket`. Fired by a
  tested hook in the view component, per the memory note on analytics in view
  components.
- `layer constraint added`: `verb` (`front` | `behind`), `subject_origin` and
  `object_origin` (`pattern` | `folded`), `constraint_count_bucket`.
- `layer order cant fit shown`: `reason` (`no_order` | `forced` |
  `nothing_left` | `undecided`), `constraint_count_bucket`.
- `layer order dialog closed`: `outcome` (`applied` | `cancelled`),
  `constraint_count_bucket`, `solutions_bucket` (`unknown` | buckets),
  `elapsed_ms_bucket`.
- `layer constraints need attention`: the hosts' slice.

Rules:

- Enums and buckets only; no face letters, no counts unbucketed.
- If the hosts open the dialog through a `MENU_ACTION_ID`, the chokepoint
  already counts the open, and `dialog opened` still adds `surface` and size.
  That is not a double count, since it carries different information.

### Size, risks, tests

- **Size:** L in total:
  - model and reducer M;
  - hook M;
  - components M;
  - keyboard scope M;
  - i18n S;
  - analytics S.
- **Risks:**
  - Locale word order (§4.5).
  - The native-menu undo path.
  - An accessible way to pick faces without a pointer. There is none in the
    design: the slots are filled only by clicking a pane. Proposal: a slot
    button opens a `Menu` of its pickable faces by letter ("C · 3 faces to
    choose from"). That is the keyboard and screen-reader path. Owner
    question.
- **Tests:**
  - Reducer tests over the prototype's rules:
    - Add clears the sentence;
    - Add is disabled with a reason;
    - a stuck subject says "nothing left to choose";
    - row → subject;
    - undo and redo restore constraints and witness;
    - Clear all is undoable;
    - a back-side sentence stores front-relative.
  - Component tests by role and name (`getByRole('button', { name: /Add
    constraint/ })`, never by module class).
  - Keyboard: a dialog chord is claimed only while the dialog is on top, and
    the workspace executor never sees ⌘Z.
  - `i18n:check`.
  - An analytics tracker test with a mocked `track`, as
    `analytics/__tests__/trackCreasePatternExport.test.ts` does.

---

## 5. Running the engine

### What exists (Verified)

- **The worker.** `workers/foldSequenceWorker.ts` holds one `FoldEngine` over
  the `oristudio-fold-wasm` module (`:126-145`).
  - Calls that change the engine queue behind one another (`changing`,
    `:204-206`).
  - Engine calls cannot be interrupted. Only TypeScript-side searches run in
    slices with cancel tickets (`fold/engine/foldSearch.ts:16-26, 128`).
  - Import calls are on it: `importCp`, `importSearch`, `importPick`,
    `releaseImports` (`:373-405`). There is no session or check method.
- **Its owner.** `store/workspaceStore/foldSequenceRuntime.ts`:
  - a ref-counted singleton (`retain` / `release`, `:116-144`);
  - `stopFoldSequenceWork` terminates it, and "every state goes with the
    worker" (`:150-154`);
  - a generation counter;
  - `whileFoldSequenceClientAlive` (`:90-96`) rejects orphaned comlink calls;
  - `createFoldPreviewChannel` is latest-wins (`:265-300`), typed to this
    client.

  Retained by the Fold workspace, and by the Diagram while it shows steps
  linked to Fold.
- **The wasm session.** `import_session(import, limits)` and
  `import_check(import, pairs, limits)`
  (`crates/oristudio-fold-wasm/src/io/bindings.rs:94-119`). Doc: "no caller in
  apps/web yet" (`:14-15`). Held as `Held.session: Option<Checking { session,
  shown }>` (`crates/oristudio-fold-wasm/src/io/imports.rs:41-57`).
  - `open_session` returns `{ import, forced: count, nodes }` (`:244-267`).
  - `check` builds `FixedPair`s as seeds and prefers `checking.shown`. **On
    `Fits` it always sets `checking.shown = order`** (`:294-317`). It returns
    `changed` and `forced` as **counts** (`:311-316`), although the core's
    `Check::Fits` carries `forced: Vec<[FaceId;2]>`
    (`crates/oristudio-fold/src/complete.rs:925-934`).
  - Other verdicts: `Forced { pair, traced }`, `Contradictory`,
    `Conflict { family, faces, traced }`, `NoOrder { faces, traced, nodes }`,
    `Undecided { limit, nodes }` (`wire.rs:207-241`).
  - The core session also has `forced_pairs()`, `forced(a,b)`,
    `forced_by(a,b)` and `first_order()` (`complete.rs:1032-1067`), none of
    them on the wire.
  - **No deadline in wasm:** `CheckWireLimits::check()` sets `deadline: None`
    (`wire.rs:185-194`). Budgets are node counts only.
  - Speeds from #476, for the record: iguana open 1.53 s in wasm, a fitting
    check 0.66 s median and 2.3 s max; the slowest admitted design opens in
    5.6 s in wasm (`implementation-plans/fold-solver-performance.md:186-200,
    227-230`).
- **How Import CP pictures an order today:** `importPick` lands a state,
  reads `scene(state)`, then releases it (`fold/io/foldImportFlow.ts:333-343`).
  That is a round trip per picture.
- **Precedent for one worker per cancellable job:**
  `engine/cpExactSolveSession.ts:1-36` (settle every in-flight call, then
  `terminate()`).
- **Bundling.** The Fold worker and wasm are fetched on first use and never
  warmed (`apps/web/vite.config.ts:139-149`, `UNWARMED_PATTERNS`). A new
  worker bundle needs an entry there, or every visitor's install precaches
  it (Inferred from the pattern).
- **Memory.** The first iguana run peaked at 170 MB resident, natively and on
  the old solver (`fold-solver-profile.md:108-109`).

### What is missing (the dialog's needs, against the wire)

| Dialog need | Wire today | Needed (engine slice) |
| --- | --- | --- |
| Pickable subjects, open objects | `forced` count | **open pairs** after open and after each commit, as a typed array (open pairs are few: 99.4% are forced on iguana-c0, `fold-solver-profile.md:130`) |
| Preview a sentence, then not keep it | `Fits` always sets `shown` | `check(pairs, { commit: false })` |
| Undo / browse / reopen to a saved order | prefers `shown` only | `check(pairs, { prefer: witness })`, or `show(witness)` |
| Draw the shown or preview order | none (Import lands a state to picture it) | the scene once, then **per-cell stacks per side** as typed arrays for each order; the client patches `subfaces[i].faces_top_to_bottom` (cells are stable, `scene.rs:286-309`) |
| Save the chosen order | none | the shown order's pairs (witness) |
| Open spots (switch) | none | open cells per side, from the forced relation |
| "Can't fit" with the smallest clashing set | `traced` faces | deletion-based explain over the constraints, sliced and cancellable (core: repeated checks) |
| "N solutions", ‹ n of N › | `import_cp`'s per-component counts, without seeds or looks | count orders and looks under seeds, with witnesses per look, budgeted |
| "Couldn't check in time" | node budget → `Undecided` | keep node budgets; the dialog maps `Undecided` to the message |

### Proposal

- **The client contract:** `layer-order/engine/layerOrderEngine.ts`, types
  only; the engine slice implements the wasm side.

  ```ts
  export interface LayerOrderOpened { faces: number; scene: { front: FoldScene; back: FoldScene }; open: Uint32Array /* lo,hi pairs, FaceIds */;
    openCells: { front: Uint32Array; back: Uint32Array }; witness: Uint32Array /* upper,lower */; nodes: number }
  export type LayerOrderChecked =
    | { verdict: 'fits'; stacks: { front: PackedStacks; back: PackedStacks }; witness: Uint32Array;
        open?: Uint32Array; openCells?: { front: Uint32Array; back: Uint32Array } /* when committed */ }
    | { verdict: 'forced' | 'contradictory' | 'conflict' | 'no_order'; faces: Uint32Array; traced: Uint32Array }
    | { verdict: 'undecided'; nodes: number };
  export interface LayerOrderEngine {
    open(source: FoldImportSource, startSide: Side, limits?: FoldImportLimits): Promise<FoldEngineOutcome<LayerOrderOpened>>;
    check(pairs: Uint32Array, options: { commit: boolean; prefer?: Uint32Array; maxNodes?: number }): Promise<LayerOrderChecked>;
    explain(pairs: Uint32Array, candidate: [number, number]): Promise<{ clash: number[] /* indices of pairs */ } | null>;
    dispose(): void;   // settle in-flight, terminate
  }
  export interface LayerOrderCounter { count(pairs: Uint32Array, side: Side, limits: { maxNodes: number; maxLooks: number }):
    Promise<{ orders: { n: number; exact: boolean }; looks: { n: number; exact: boolean; witnesses: Uint32Array[] } }> }
  ```

  The client converts `FaceId` ↔ scene position with `scene.lineage` once,
  in `layer-order/engine/faceIndex.ts`. The model works in positions
  throughout.
- **`workers/layerOrderWorker.ts`:** its own `FoldEngine` (same wasm module,
  `init()` as at `foldSequenceWorker.ts:126-145`), exposing the contract
  through comlink.
  - The dialog spawns it on open and terminates it on close.
  - Cancelling the open (up to about 5.6 s) means settle, then terminate,
    as in `cpExactSolveSession.ts`. Nothing of Fold's is touched.
- **`layer-order/engine/layerOrderRuntime.ts`:** spawn, generation,
  `whileAlive`, worker-failure diagnostics (`attachWorkerDiagnostics`), and a
  report on a trap (`reportError`, surface `layer-order:engine`).
- **Previews are latest-wins.** At most one check in flight and one waiting;
  a newer sentence supersedes the waiting one. A check in flight cannot be
  stopped, but node budgets bound it. Generalise `createFoldPreviewChannel`
  over its client type (`foldSequenceRuntime.ts:278`) into
  `lib/latestWinsChannel.ts`, with Fold as its first user and the dialog its
  second, rather than copying it.
- **The background count runs in a second instance of the same worker.**
  - It is spawned after the open, and imports the same source with its own
    session.
  - It is **terminated and respawned on every constraint change**, so it
    never blocks a check and needs no cooperative slicing.
  - Its results are tagged with the constraint-set key and dropped when
    stale.
  - Above a face or stack threshold (the owner decides; iguana-class
    figures), the count does not start and the status line is absent, as
    spec §6.9 allows.
- **One open, two workers.** Both workers import the same bytes.
  Determinism of face ids across two imports is **Inferred**; a wasm test
  asserts it.
- **`vite.config.ts`:** add `/^assets\/layerOrderWorker-[^/]+\.js$/` to
  `UNWARMED_PATTERNS`.
- **Not the Fold singleton,** for three reasons:
  - stopping it kills every Fold state, and the Diagram may be holding it
    for linked steps;
  - the dialog's calls would queue behind Fold's replays (`changing`);
  - a held import in Fold's engine would outlive a dialog that crashed.

  The cost is a second wasm instance, plus a third for the count, and the
  memory that goes with them (risk).

### Size, risks, tests

- **Size:** M on the web side: worker, runtime, client, channel
  generalisation, wasm tests. The wire additions in the table are the engine
  slice's; I would size them M, but they are not mine to plan.
- **Risks:**
  - **Memory.** Three wasm instances on a large figure: Fold's, the
    dialog's, the counter's. 170 MB resident for one native iguana import
    (old solver) suggests this matters on iPad and phones (Inferred).
    Mitigation: no counter above a threshold, and the dialog releases
    everything on close.
  - **Payload.** Full scenes per check would be large on deep stacks.
    Shipping packed stacks per side keeps it to roughly the sum of stack
    sizes (Inferred).
  - **No wasm deadline.** "Couldn't check in time" depends on node budgets
    alone, and their wall time varies by figure (Inferred).
  - **The Edit import path** (Edit's rules for unassigned and F lines,
    non-rectangular sheets, `quarter_turn` in the import summary,
    `foldEngineIoWire.ts:79-80`) decides whether a paper point round-trips to
    the host's coordinates. That is the engine and face-bridge slices.
- **Tests:**
  - `layerOrderEngine.wasm.test.ts` over the real bridge in process (the
    `foldEngineIo.wasm.test.ts` pattern, skipped when the bridge is not
    built), on kabuto and solution_sample_1:
    - `open` returns open pairs and a scene;
    - `check({commit:false})` leaves the next check's preference unchanged;
    - `commit` changes it;
    - `prefer` restores a witness;
    - patched stacks equal a fresh scene's;
    - two imports give the same face ids.
  - A runtime test with a fake worker: dispose rejects in-flight calls before
    terminating, and stale count results are dropped.
  - The Rust wire tests are the engine slice's, on top of
    `crates/oristudio-fold-wasm/tests/import_session.rs`.

---

## 6. Sharing with the Fold workspace

**What changed since `design/fold-share.md`:** "Layers here" is gone, so the
`LayerStackList` shell (fold-share §4.2-C) has no second user. **Do not build
it.** Fold's `FoldCrossSectionPicker` stays as it is.

### What still applies

1. **The stack hit index (§3).** It is the same thing in both: Fold's moving
   and target tints, its picks and letters, and the dialog's spots and faces.
   The dialog adds the cell id and the face-at-paper-point test. S.
2. **`cp-workspace/renderer/fillTint.ts`, the tint ladder.**
   `foldPaneOverlays.ts` repeats the same fan triangulation three times
   (`:172-196, 212-246, 258-292`), and the dialog would add five more uses.

   ```ts
   export const TINT = { faint: 0.16, hover: 0.26, moving: 0.30, picked: 0.42, emphasis: 0.50 } as const; // Fold's numbers, named
   export function ringsFill(rings: readonly (readonly Point[])[], rgba: Rgba, alpha: number): FillGeometry | null;
   export function cellsFill(index: StackHitIndex, cells: Iterable<number>, rgba: Rgba, alpha: number): FillGeometry | null;
   export function cellsHoldingFill(index: StackHitIndex, faces: ReadonlySet<number>, rgba: Rgba, alpha: number): FillGeometry | null;
   export function joinFills(a: FillGeometry | null, b: FillGeometry | null): FillGeometry | null; // moved from foldPaneOverlays.ts:294
   export function ringStrokes(rings: readonly (readonly Point[])[], rgba: Rgba, widthMul: number): StrokeGeometry | null; // outlines
   ```

   - Fold's `foldRegionTint`, `foldTargetsTint` and `foldMovingTint` become
     thin wrappers that keep their lineage mapping and line clipping
     (`clipConvex`), which are Fold's own.
   - The ladder is shared because two surfaces that do not know about each
     other must agree on what "hovered" and "picked" look like over paper.
   - S–M.
3. **`PaperPane` (§2.1).** Same channels, same lifecycle; FoldPane becomes a
   specialisation. M. This is the one with the most risk (open PRs,
   playback), so it is its own commit, gated on Fold's canvas tests and a
   before/after screenshot.
4. **`ModalFrame` (§1).** Not a Fold-specific item, but Fold's Import CP is
   its second user.
5. **`lib/latestWinsChannel.ts` (§5).** Generalised from Fold's preview
   channel.

### What stays separate

- `crossSection.ts`, `FoldCrossSectionPicker`, the flap chips: Fold's
  meaning (flaps, lines, moving).
- `FoldOrderChooser`'s pager (‹ Order n of m ›): it steps raw orders of one
  part. The dialog's stepper steps *solutions* (looks) under constraints, with
  a background count. The two look alike and mean different things. Share
  the icon idiom only.
- `useFoldCanvasInks`: the dialog can call it as it is (it lives in
  `fold/canvas`, and the dialog already depends on Fold's scene modules).
  There is no need to rename or move it.

**Over-abstraction checks** for these pieces:

- `PaperPane` takes channels, never states. A `variant` prop, or a prop that
  names a Fold or dialog concept, means stop.
- `fillTint` holds geometry and alphas only. Roles and precedence stay in
  each caller (`layerOrderTints.ts`, `foldPaneOverlays.ts`).

### What Fold's order chooser becomes (decision 6), later phase

There are two choosers today:

- **Import CP:** `FoldImportOrderChooser` (`components/fold/orders/FoldImportOrderChooser.tsx`)
  over a held import, with "Region n" per part, ‹ Order n of m ›, "Find more
  orders", and `FoldOrderStacks`' "Inspect layer stacks" text list
  (`components/fold/orders/FoldOrderStacks.tsx`,
  `fold/orders/useFoldOrderInspection.ts`, the canvas tint at
  `FoldCanvas.tsx:175-178`).
- **Compound folds:** `FoldOrderChooser` in the tool window, driven by
  `useFoldOrderResolution` (`fold/orders/useFoldOrderResolution.ts`) over
  `orderSelection`, which is not an import.

The proposal:

- **Import CP gets a "Layer order…" button** that opens this dialog on the
  same crease pattern. Apply returns a witness. The engine then needs "land
  the import by order" (a pick by witness rather than by per-component
  index), whose core exists (`Completions::choice_of`,
  `crates/oristudio-fold/src/complete.rs:382`; it is used by `import_search`
  at `imports.rs:175-177`).
- **"Inspect layer stacks"** and `useFoldOrderInspection` are deleted in
  that change. The dialog replaces them.
- **Keep the ‹ Order n of m › pager** for figures with a handful of orders.
  It is a faster path when there are 2 or 3. Owner call.
- **Compound folds** need a session over the step's unordered pattern
  (`Unordered::session` exists in the core per the #476 plan,
  `fold-solver-performance.md:239-241`) exposed on the wire. That is a later
  phase, after the dialog ships in Edit.
- **Pane order clashes.** Fold puts the folded pane left; the approved design
  puts it right. `PaperPane` does not care, since layout is the parent's. If
  Fold ever embeds the dialog's panes, the owner picks one convention.

---

## 7. Tests and gates

### Recipes that exist (Verified)

- **Rust.** `cargo test --workspace` in CI's `native-oracle` job
  (`.github/workflows/ci.yml:277-333`), with clippy as the wrapper and fmt.
- **Oriedita oracle parity.** `oristudio-cp`'s geometry, model, io,
  operations, render and folding oracle tests, with `ORACLE_REQUIRED`
  (`ci.yml:380-397`). This is the "no constraints, no change" gate for Edit
  and the Diagram: it must stay byte-identical.
- **Flat-Folder and Fold oracles** (`ci.yml:410-427`), including `fold_oracle`
  (`crates/oracle-tests/tests/fold_oracle.rs`). Its
  `every_random_state_verifies_against_seeded_oriedita` (`:89-118`) hands
  Oriedita a Fold state's whole order through
  `fold_support::oriedita::Seeded` (`crates/oracle-tests/tests/fold_support/oriedita.rs:1-33, 59-200`):
  - faces matched by centroid;
  - the starting-face convention calibrated;
  - the verdicts `Verified`, `Unrepresentable`, `Contradiction`, `NotFound`,
    `Disagrees` and `Failed`.

  This is the template for the display gate.
- **cpoogle harnesses from #476**, local and never in CI:
  - `crates/oristudio-fold-wasm/examples/solver_differential.rs`, and
    `solver_session_check.rs` (randomised session questions cold, warm and
    chained; `OPEN_NODES`, `CHECK_NODES`, `FAST_NODES`);
  - `crates/oristudio-fold-wasm/tests/stacking_corpus.rs`, with
    `FOLD_STACKING_CORPUS_DIR=<cpoogle>`, run in release over
    `<case>/truth.fold` (`:1-20`).

  Results are in `implementation-plans/fold-solver-performance.md:100-130`.
- **Web.**
  - The `web-client` job runs lint, `i18n:check`, typecheck and `test:web`
    (vitest, jsdom, `apps/web/vite.config.ts:578-581`), after building every
    wasm bridge (`ci.yml:110-150`).
  - `*.wasm.test.ts` files run the real bridges in process and skip when
    unbuilt (`fold/engine/foldEngineIo.wasm.test.ts:27-45`).
  - Component tests use `createRoot` and `act` with mocked hooks
    (`components/fold/import/FoldImportDialog.test.tsx:1-60`,
    `components/fold/canvas/FoldCanvas.test.tsx`).
  - The styling ratchets are `src/styles/globalStylesheets.test.ts` and
    `liveSelectors.test.ts`.
  - `fold/foldDiagramBoundary.test.ts` keeps Fold out of the Diagram's
    directories.
- **Browser.**
  - Playwright scripts: `scripts/folded-grid-screenshot.mjs` is the only
    lane that draws WebGL frames. The agent pane draws none, per the script's
    own note (`:4-8`).
  - `scripts/large-osf-perf.mjs` measures long tasks and memory.
  - `scripts/webkit-pwa-check.mjs` is the WebKit lane in CI (`ci.yml:226-227`).

### Proposed gates by PR

| PR (§9) | Gate | Where |
| --- | --- | --- |
| 1. Shared picking and tints | `stackHitIndex.test.ts`, `fillTint.test.ts`. Fold's `foldPicking.test.ts`, `foldPaneOverlays.test.ts` and `FoldCanvas*.test.tsx` unchanged and green. A Fold before/after screenshot of a tuck's targets and a located fold's moving tint (no visual change). | CI web + local browser |
| 2. Engine client and worker | `layerOrderEngine.wasm.test.ts` (§5). Runtime tests with a fake worker. `vite.config` precache test (`UNWARMED_PATTERNS` matches the new bundle). Engine-slice Rust wire tests. | CI web + native |
| 3. Dialog shell | Store, mount and gateway tests. `ModalFrame` computed-style proof on Fold's Import CP. The dialog-scope keyboard tests. The history reducer. `i18n:check`. Ratchets. A boundary test: `layer-order/` and `components/layer-order/` import nothing from `diagram/`, `components/diagram/`, or the hosts' store slices. | CI web |
| 4. Panes | Unit tests for tints, labels, letters and X-ray alpha. `PaperPane` tests. Fold canvas tests unchanged. **`scripts/layer-order-dialog-check.mjs`** (new, Playwright, the `folded-grid-screenshot` pattern): kabuto, solution_sample_1 and iguana-c0 through the store, with screenshots of front, back, X-ray and open spots, and an assertion that the canvas changed. Hit-test timing on iguana-c0 reported (p99 within 4 ms). | CI web + local browser |
| 5. Inspector | Reducer and component tests (§4). Analytics tracker tests. Browser-verified on kabuto, `solution_sample_1` and iguana-c0 (spec Phase 1 "done when"): pick, preview, can't-fit, Add clears the sentence, undo, remove, back side. Phone layout at 375px in Chromium and WebKit. ⌘Z on desktop (Tauri dev) does not touch the workspace. | CI web + local browser + desktop |
| 6. Display and round-trip gates | **`crates/oracle-tests/tests/layer_order_witness.rs`** (new), below. | CI native (fixtures) + local (cpoogle) |

### The witness display gate (PR 6)

For each design:

1. Import its crease pattern **by Edit's rules**, through the engine slice's
   Edit import path.
2. Open a session and take witnesses:
   - the first order;
   - for `K` seeded-random open pairs (default 8), a check each way, where
     each `Fits` is a witness;
   - for 2 random multi-constraint sets, a committed chain, where each step
     is a witness.
3. Convert each witness to the saved form (paper points plus pair orders) and
   back. **Assert the round trip is exact.** This is the face-bridge part of
   the gate.
4. Show the witness through **Oriedita's new "show this order" entry** (the
   engine slice's additive entry in `oristudio-cp`), on the crease pattern as
   Edit loads it.
5. Read back Oriedita's hierarchy, match faces by paper point, and assert
   every seeded pair agrees.

The verdicts are `Seeded::verify`'s:

- `Verified` passes;
- `Unrepresentable` (an order across an F line) is counted and listed;
- `NotFound`, `Disagrees` and `Contradiction` fail;
- designs Oriedita refuses outright (e.g. Crane and Heart's
  `SameParityAdjacentFaces`, spec §13) are listed, not failed.

Where it runs:

- **CI:** committed fixtures only (kabuto, solution_sample_1, Oriedita's
  `colorconstrainttest.cp`, iguana-c0, the fold-design-completion exports),
  in the `Flat-Folder oracle parity` step's test list. It needs no external
  oracle, like `fold_oracle`'s seeded tests.
- **Local:** `LAYER_ORDER_CORPUS_DIR=<cpoogle>` runs every `<case>/truth.fold`
  in release (the `stacking_corpus.rs` layout and convention). It prints one
  row per design (witnesses, verified, unrepresentable, refused, time). It is
  run once per engine-affecting PR and its summary pasted into the PR. It is
  not run in CI: the corpus is never committed, and CI spend matters.

### Always-on gates for the series

- `cargo fmt --check`, clippy, `cargo test --workspace`, and the Oriedita
  oracle parity step unchanged. That is "no constraints, no change".
- `npm run lint:web`, `typecheck:web`, `test:web` (vitest under Node 22 and
  in the web workspace, per the memory notes), `i18n:check`.
- `npm run build:web` when the worker bundle or the gateway chunk changes.

---

## 8. Open questions for the owner

1. **The phone layout.** One pane at a time with the inspector below it,
   capped at about 45% of the height. Or does the inspector go in a sheet?
2. **A keyboard and screen-reader path for picking faces.** Proposed: a face
   slot opens a menu of its pickable faces by letter. Without it, the builder
   needs a pointer.
3. **Locale word order in the builder.** Is the subject–verb–object slot
   order driven by a translated template (ja and ko put the verb last), or
   fixed?
4. **Keys inside the dialog.** Add a dialog scope to `keyboard/` so ⌘Z and
   ⇧⌘Z undo the dialog's own history and can be rebound (recommended, M)? Or
   a local `onKeyDown` like the References browser (S)?
5. **The desktop native menu.** While a modal is open, should Edit ▸ Undo be
   refused, or routed to the dialog's history? Today it reaches the workspace
   behind every modal (Inferred; needs a desktop check).
6. **Escape with a sentence in progress.** Clear the sentence first, then
   close on a second Escape? Or always close, as Cancel?
7. **Large figures.**
   - Above which size does the background count not start? The status line
     is then absent.
   - How many labels may the folded pane show before it labels only the
     hovered face?
8. **The X-ray alpha.** Accept "the deepest stack reaches about 60%" and
   check it on kabuto and iguana-c0?
9. **Dialog size.** Is `min(1320px,100%) × min(880px,100%)` acceptable? The
   References browser is 1180 × 860.
10. **Fold's chooser (decision 6, later).** Keep ‹ Order n of m › for small
    counts beside "Layer order…", or replace it?

---

## 9. Suggested PR split for this slice

All stacked on the dialog's branch off #476. The engine slice's wire work
(§5 table) and the hosts' slice are planned elsewhere. PRs 2 and 5 depend on
the wire.

1. **Shared picking and tints** (S–M):
   - `stackHitIndex.ts`, Fold moved onto it;
   - `fillTint.ts` with the named ladder, Fold's three tints as wrappers.

   No visual change. Gates: §7 row 1.
2. **Engine client and worker** (M):
   - `layerOrderEngine.ts` types, `faceIndex.ts`;
   - `workers/layerOrderWorker.ts`, `layerOrderRuntime.ts`;
   - `lib/latestWinsChannel.ts`, Fold's preview channel moved onto it;
   - the `vite.config` precache entry.

   Depends on the engine slice's wire additions.
3. **Dialog shell** (M):
   - `ModalFrame`, Fold's Import CP moved onto it as its own commit;
   - `layerOrderDialogStore`, the gateway, the `App.tsx` mount;
   - an empty `LayerOrderDialog` with Cancel and Apply;
   - the keyboard dialog scope, `layerOrderHistory`;
   - i18n scaffolding, the boundary test.
4. **Panes** (L):
   - `PaperPane`, `FoldPane` as a specialisation, its own commit;
   - `LayerOrderPanes` with per-pane `ViewportToolbar`s;
   - the Front/Back, X-ray and Open spots switches;
   - `layerOrderTints`, the flash, `faceLabelPlacement`, `faceLetters`,
     `FaceLabelLayer`;
   - the Playwright check script.
5. **Inspector** (L):
   - `layerOrderModel` and reducer, `useLayerOrderDialog`;
   - the status and stepper, the sentence builder, the constraint list;
   - trackers, translations for all 8 locales;
   - Apply returning the result to the host contract.
6. **Witness display and round-trip gate** (M):
   - `oracle-tests/tests/layer_order_witness.rs`, fixtures in CI;
   - the cpoogle run documented in `tests/corpus/README.md`.

   Lands with or right after the engine slice's Oriedita "show this order"
   entry, and before any host shows a chosen order.

Each PR keeps its own implementation-plan checklist under
`implementation-plans/` (AGENTS.md). The browser checks in PRs 4–5 come with
before/after screenshots.

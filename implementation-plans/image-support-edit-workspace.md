# Image Support in the Edit Workspace

## Goal

Let users **drag-and-drop images onto the crease-pattern canvas** and **move,
resize, rotate, and crop** them, as reference underlays beneath the creases.
This is the **first superset feature** — a capability with no equivalent in
Oriedita, from which `oristudio-cp` was ported. The whole design is organized
around making that a *repeatable pattern* rather than a one-off:

- Ori Studio's native `.osf` is a **superset** of every format it can export.
- Superset features (images, and whatever comes next) **round-trip losslessly
  through `.osf`** and are **cleanly omitted from Oriedita-compatible exports**
  (`.cp`, `.fold`, `.ori`, `.orh`, DXF, OBJ, SVG, PNG) with a **single shared
  warning** telling the user exactly what will be dropped.

## Governing principle: keep the Rust kernel pure

Every Oriedita-format export runs **inside the wasm CP handle**, i.e. against
the ported `oristudio-cp` kernel (`export_cp`/`export_fold`/`export_ori`/
`export_orh` — see [oristudioCpWorker.ts:249](../apps/web/src/workers/oristudioCpWorker.ts)).
That crate is our Oriedita-fidelity contract and export source of truth.

**Images must never enter `oristudio-cp`.** Consequences:

- Every Oriedita export omits images automatically, with **zero changes to any
  export path**. Graceful degradation is a property of the architecture, not of
  per-export code.
- Images live in a **web-side document layer**, owned by the workspace store,
  persisted only in `.osf`, rendered as its own GPU layer, and edited by
  web-side tools.

The layering rule to establish as the pattern:

> **Kernel-native concepts** (creases, circles, text, grid) live in
> `oristudio-cp` and round-trip to Oriedita. **App-native superset concepts**
> live in a web-side layer, persist only in `.osf`, and register themselves as
> *lossy-on-export* through a shared registry (§7).

This pattern is documented for future features as a standalone guide:
[`apps/web/docs/superset-features.md`](../apps/web/docs/superset-features.md).
Images are its reference implementation — keep the two in sync if the pattern
evolves during this build.

Images are **attached to the crease-pattern document** (per decision) — they are
CP reference underlays, not a workspace-global layer.

---

## 1. Data model (web-side)

New module `apps/web/src/cp-workspace/images/cpImage.ts`:

```ts
export interface CpImage {
  id: string;                       // stable uuid
  /**
   * The capped, re-encoded image as a data URL (base64) — the single source of
   * truth (§1.1). Feeds both the GPU texture and `.osf`; there is no separate
   * "original" copy. Self-contained; see §6.
   */
  src: string;
  naturalWidth: number;             // capped-blob pixels (≤ IMAGE_MAX_DIMENSION)
  naturalHeight: number;
  /** Placement in CP *model* coordinates so it tracks pan/zoom exactly. */
  center: { x: number; y: number };
  /** Displayed size in model units (before rotation), i.e. the quad extent. */
  width: number;
  height: number;
  /** Rotation about `center`, radians, CCW. */
  rotation: number;
  /** Normalized crop rect into the source, 0..1. Default { x:0, y:0, w:1, h:1 }. */
  crop: { x: number; y: number; w: number; h: number };
  opacity: number;                  // 0..1
  locked: boolean;                  // ignore hit-testing / edits when true
  hidden: boolean;                  // skip drawing
  z: number;                        // draw order within the image layer
}
```

Placement is in **model coordinates** — the same space `CpTextOverlay` projects
through (`CpOverlayView`, see [CreasePatternWebglCanvas.tsx](../apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx)).
That is what makes images pin correctly through pan/zoom with no per-image
bookkeeping.

Store state lives beside the CP document (new field on the crease-pattern slice,
[creasePatternSlice.ts](../apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts)):
`images: CpImage[]`, plus a `selectedImageId: string | null` and an
`imageInteraction` transient (the in-flight gesture, §4). Mutators:
`addCpImage`, `updateCpImage(id, patch)`, `removeCpImage`, `reorderCpImage`,
`setSelectedImage`.

### 1.1 Import pipeline — cap and re-encode once

Image bytes have **exactly one consumer**: the on-screen reference underlay.
They are omitted from every Oriedita export, and `.osf` is the only place they
live — there is no full-res export path. So we do **not** keep the original
bytes. On add, we downscale + re-encode **once**, and the result is the single
source of truth for both the GPU texture and `.osf`:

1. `createImageBitmap(file)` — off-main-thread decode.
2. If the longest edge exceeds `IMAGE_MAX_DIMENSION` (**2048 px**, a named
   constant), draw to an offscreen canvas at the capped size with high-quality
   smoothing. Otherwise pass through.
3. **Re-encode deliberately by content:** JPEG at quality ~0.85 for opaque
   sources, PNG only when the source can carry transparency (source type is
   PNG/WebP/GIF). Photographic references are 3–5× smaller as JPEG than as PNG —
   this is the main `.osf`-size lever.
4. The re-encoded blob → data URL becomes `src`; `naturalWidth/Height` are the
   *capped* dimensions.

This single step bounds **both** `.osf` file size (§6) and GPU/VRAM usage (§3.3)
— the two used to be separate risks and are now one mitigation.

---

## 2. Rendering — a GPU textured-quad layer

Add `apps/web/src/cp-workspace/renderer/programs/imageProgram.ts`, modeled on
[fillProgram.ts](../apps/web/src/cp-workspace/renderer/programs/fillProgram.ts)
(same model→device affine via `u_origin`/`u_ex`/`u_ey`, same premultiplied-alpha
blend). Differences:

- **Per-image draw call.** Each image is a quad (two triangles) with a bound
  `sampler2D`. Image counts are low (tens), so N draw calls is fine; no batching.
- **Attributes:** unit quad `[-0.5..0.5]²` corners + UVs. Vertex shader applies
  the image's local transform (translate `center`, rotate `rotation`, scale
  `width`/`height`) in model space, then the shared model→device affine. Crop is
  a UV remap `uv * crop.wh + crop.xy`. Opacity multiplies sampled alpha
  (premultiplied in-shader like fillProgram's FRAG).
- **Texture:** `regl.texture({ data: ImageBitmap, premultiplyAlpha: true, min:
  'linear mipmap linear', mag: 'linear', mipmap: true, flipY: false })`.
  Premultiplied to match the `premultipliedAlpha: true` context and the fill
  program's blend func `(1, one-minus-src-alpha)`.

Renderer seam ([CpRenderer.ts](../apps/web/src/cp-workspace/renderer/CpRenderer.ts) /
[reglRenderer.ts](../apps/web/src/cp-workspace/renderer/reglRenderer.ts)):

- New `setImages(images: CpImageDraw[] | null)`: uploads/replaces textures.
  A `CpImageDraw` carries the transform + crop + opacity + a texture handle.
  The renderer owns a small `id → { texture, ...}` cache so `setImages` only
  (re)uploads textures whose `src` changed; transform-only updates never touch
  the GPU texture.
- New `setImageTransforms(...)`: cheap per-frame path that replaces only the
  transform/crop/opacity uniforms of already-uploaded images, for live drags —
  the exact analogue of the existing `setStrokes`/`setPoints` move-drag path.
- **Draw order:** images render **above the grid but below the creases** —
  in `render()` **after** the grid draw and **before** `strokes.draw` (see the
  draw sequence in [reglRenderer.ts:164](../apps/web/src/cp-workspace/renderer/reglRenderer.ts)).
  The grid is the bottom backdrop; the reference image sits over it, and
  creases, points, diagnostics, and text annotations all sit **on top** of the
  image (the trace-over use case) — so image opacity (§1) lets the grid show
  through when desired. Within the layer, draw sorted by `z`. Hidden images are
  skipped.
- `dispose()` destroys all image textures.

---

## 3. Performance — issues & mitigations

Performance is a priority; the GPU path is the target from day one. The concrete
risks and how we handle each:

### 3.1 On-demand rendering vs. smooth transform drags
The renderer is **on-demand** — it redraws only on state change, not every frame
(`preserveDrawingBuffer: true`, no `regl.frame`; see
[reglRenderer.ts:30](../apps/web/src/cp-workspace/renderer/reglRenderer.ts)). A
drag/resize/rotate must still feel smooth.
- **Mitigation:** reuse the existing move-drag pattern. During a gesture we do
  **not** rebuild buffers or re-upload textures; we update only the active
  image's transform via `setImageTransforms` and call `render()`. `render()` is
  a handful of draw calls and already runs every frame during crease moves.
- Coalesce `pointermove` → **one `render()` per rAF** (the canvas already drives
  renders off state; funnel image gestures through the same rAF tick).

### 3.2 Texture upload / decode cost (the drop-frame stall)
Uploading a large image on the drop frame can jank, and `<img>`/`decode()` on
the main thread blocks.
- **Decode off the main thread** via `createImageBitmap` (§1.1), which also does
  the cap downscale — yields a GPU-friendly `ImageBitmap` at ≤ 2048 px.
- **Upload once**, on add or `src`/crop change — never per frame.
- Capped uploads are single-digit ms; no placeholder needed in practice.

### 3.3 GPU memory / VRAM pressure — handled by the import cap (§1.1)
With the 2048 px cap, each texture is at most 2048×2048×4 ≈ 16 MB (+mipmaps
≈ 21 MB), regardless of how huge the source was. Ten images ≈ 200 MB — fine on
anything but the weakest integrated GPU. No view-frustum texture eviction needed
(premature). Additionally:
- Clamp the cap to `min(IMAGE_MAX_DIMENSION, gl.MAX_TEXTURE_SIZE)` for safety on
  old GPUs.
- **Mipmaps** (`min: 'linear mipmap linear'`) for quality *and* speed when the
  image is minified (zoomed out) — avoids shimmer, reduces sampling cost.
- **Free eagerly:** destroy the texture on delete and in `dispose()`.
- **Dedup by content hash:** identical `src` shares one texture *and* one base64
  blob in `.osf` (§6). Cheap SHA-256 of the capped bytes on add.

### 3.4 Alpha / color correctness
- Context is `premultipliedAlpha: true`, `alpha: false`; blend must match the
  fill program `(1, one-minus-src-alpha)` with premultiplied textures — use
  `premultiplyAlpha: true` on the texture. Verify no dark-fringe halos on
  transparent PNGs.
- Rotated/minified quads: MSAA on the default framebuffer (`antialias: true`,
  already set) covers quad *edges*; mipmaps + linear cover *interior* sampling.
- sRGB: WebGL samples raw bytes; acceptable for reference underlays. Note as a
  known minor color-management gap, not a v1 blocker.

### 3.5 Hit-testing
Do it **on the CPU in model space** (point-in-oriented-rect, accounting for
rotation + crop), not GPU picking. O(#images) per pointer event, trivially cheap.
Respect `locked`/`hidden`.

---

## 4. Interaction

### 4.1 Drag & drop to add
Add drop handling on the viewport container `cp-panel__viewport`
([CreasePatternPanel.tsx:2497](../apps/web/src/components/panels/CreasePatternPanel.tsx)):
`dragover` (preventDefault + copy cursor) and `drop`. On drop of an image file:

1. Unproject the drop point to model coords (canvas exposes
   `unprojectDevicePoint`).
2. Run the import pipeline (§1.1: decode → cap → re-encode), hash, dedup.
3. Insert a `CpImage` centered at the drop point, sized to a sensible default
   (fit within the current view, preserving aspect), `rotation: 0`, full crop.
4. Select it; record undo (§5).

`CpDetectImportModal` already implements image drag/drop plumbing to crib from.
Also support an "Insert Image…" file-picker command as a non-drag path.

### 4.2 Transform tool + selection overlay (Affinity-style)
Add an **"Image" tool/mode** to the CP tool registry
([tools/registry.ts](../apps/web/src/cp-workspace/tools/registry.ts)) so image
editing is a mode alongside the draw tools. When an image is selected, a DOM
overlay `CpImageOverlay` (peer of
[CpTextOverlay.tsx](../apps/web/src/cp-workspace/CpTextOverlay.tsx), positioned
via `CpOverlayView`) draws the affordances — **DOM handles over the GPU-drawn
image**, exactly the codebase's geometry-on-GPU / interaction-on-DOM split:

- **Bounding box** around the (rotated) image.
- **8 resize handles** — 4 corners + 4 edge midpoints.
  - Corner drag resizes both axes; **Shift preserves aspect ratio**.
  - Edge drag resizes one axis.
- **Corner rotate handles (Affinity Designer behavior):** the rotate hotspot is
  the ring **just outside each corner** — hovering there shows a rotate cursor;
  dragging rotates about the image center.
  - **Shift while rotating snaps to fixed 15° increments** (a named constant).
    Show the live angle readout during the gesture.
- **Move:** drag the image body to translate.
- **Crop mode:** toggle (double-click the image, or a toolbar/context action).
  In crop mode the handles adjust the normalized `crop` rect (and quad extent)
  instead of scaling the source; exit commits. Crop is pure UV + quad math
  (cheap, §3).

Gesture lifecycle uses the transient `imageInteraction` state: on pointerdown
snapshot the starting transform; on pointermove compute the new transform and
call `setImageTransforms` + rAF `render()` (no store thrash, no texture work);
on pointerup commit the final transform to the store and record one undo entry
(§5). This mirrors the crease move-drag lifecycle precisely.

Handles are few and only on the selected image, so DOM is the right tool and we
inherit pointer hit-testing and cursors for free.

---

## 5. Undo / redo

Image add/move/resize/rotate/crop/delete must be undoable in the **same stack**
as crease edits, so one Undo reverses the last action regardless of layer.
`snapshotHistory.ts` is explicitly generic and earmarked for CP
([snapshotHistory.ts](../apps/web/src/store/workspaceStore/snapshotHistory.ts)).
The CP editing context's snapshot must **include `images`** so restoring a
snapshot restores the image layer too. A gesture records **one** entry on
pointerup (not per pointermove).

---

## 6. Persistence in `.osf`

Format lives in
[nativeProjectFile.ts](../apps/web/src/lib/nativeProjectFile.ts). It already has
the right shape and a migration mechanism.

- **Typed first-class field**, not the untyped `extensions` bag: add
  `images: CpImage[]` to `NativeCreasePatternDocumentV1` (the bag stays reserved
  for unknown/third-party data — see the gap fix below).
- **Bump** `NATIVE_PROJECT_SCHEMA_VERSION` **2 → 3**. Add validation
  (`validateDocumentV1`) that defaults a missing/invalid `images` to `[]`, and a
  migration so v1/v2 files load as v3 with `images: []`.
- Keep `minimumReaderSchemaVersion: 1` so older app builds still **open** v3
  files (they ignore `images` and drop them on re-save — the accepted
  degradation).
- **Bytes:** embed as base64 data URLs inside the JSON (decision: base64 to
  start), keeping `.osf` a single self-contained file. **Dedup identical images
  by content hash** so repeated placements don't bloat the file. Note the size
  tradeoff; an external/zip container is a future option if files get heavy.

### 6.1 Soft size warning on save
The import cap (§1.1) keeps most projects small, but a project with many images
can still add up. Track a running `totalImageBytes` on the crease-pattern slice
(sum of the capped base64 payloads) and, at **save time**, if it exceeds
`IMAGE_TOTAL_BYTES_WARN` (**~25 MB**), show a **non-blocking** notice reusing the
same pre-save hook as the export-loss dialog (§7):

> *"This project embeds ~40 MB of images and may be slow to open or sync."*

Keyed on **total bytes, not image count** (30 small logos are fine; 3 large
scans are the problem). It never blocks the save.

### 6.2 Fix the `extensions` round-trip gap (agreed)
`createNativeCreasePatternDocument` currently hardcodes `extensions: {}`
([nativeProjectFile.ts:378](../apps/web/src/lib/nativeProjectFile.ts)), so any
unknown extension data present when a file was opened is **silently dropped** on
save. For a format meant to be a forward-compatible superset this is a real
data-loss bug. Fix: **thread the previously-loaded `extensions` through save and
re-emit it** (document-level and workspace-level), so data written by a *newer*
app version survives a round-trip through an *older* one. This is a prerequisite
for the superset guarantee, independent of images.

---

## 7. The export-warning pattern (the reusable core)

There is no existing "features will be omitted" mechanism — we are establishing
it. Don't scatter checks across handlers; introduce a **lossy-feature registry**
`apps/web/src/lib/supersetFeatures.ts`:

```ts
export interface SupersetFeature {
  id: string;                          // 'images'
  label: string;                       // 'Images'
  /** How many are present in this CP document (0 ⇒ absent). */
  count(doc: CreasePatternDocumentState): number;
  /** Export formats that cannot store this feature. */
  droppedByFormats: ExportFormat[];    // every non-'osf' format
}

export function collectExportLossWarnings(
  format: ExportFormat,
  doc: CreasePatternDocumentState,
): { feature: string; count: number }[];
```

Register `images` as the first feature. Every export/save handler
([menuActions.ts](../apps/web/src/commands/menuActions.ts) /
[fileService.ts](../apps/web/src/platform/fileService.ts)) calls
`collectExportLossWarnings(format, doc)` **before writing**; if non-empty, show a
confirm dialog:

> *"This project uses features the **CP** format can't store. They'll be omitted
> from the export: **Images (3)**. Continue?"*

`.osf` save never warns (it's the superset). The **next** superset feature is a
one-line registry addition — that registry *is* the pattern this feature
establishes.

---

## 8. Capabilities & menus

Add to [workspaceCapabilities.ts](../apps/web/src/lib/workspaceCapabilities.ts):

- `file.insertImage` — enabled when an editable CP is active (`canEditCp`),
  hidden in BP/simulate/tree contexts via the existing masking.
- Image-tool activation + image edit/delete capabilities gated the same way as
  the other CP editing commands.
- Wire the "Insert Image…" entry into the File menu
  ([menuDefinition.ts](../apps/web/src/menus/menuDefinition.ts)) and the image
  transform actions into Edit/context menus.

---

## 9. Phasing

Each phase is independently reviewable and tool-verifiable (tsc/vitest).

1. **Model + persistence (headless).** `CpImage` types, store field + mutators,
   `.osf` schema v3 (persist/load/migrate) + the `extensions` gap fix (§6.2).
   Unit tests for round-trip and migration. No UI yet.
2. **GPU image layer.** `imageProgram.ts`, `setImages`/`setImageTransforms`
   renderer seam, above-grid/below-creases draw ordering, texture cache +
   downscale cap + dedup. Render static images from loaded `.osf`.
3. **Drop-to-add + selection + move.** Viewport drop handling, CPU hit-testing,
   `CpImageOverlay` bounding box, body-drag translate, live-drag path.
4. **Resize / rotate / crop.** 8 resize handles (Shift = aspect lock), corner
   rotate handles with **Shift = 15° snap**, crop mode. Undo integration for all
   image gestures (§5).
5. **Export-loss registry + warning dialog** (§7) wired into every export/save,
   plus the soft total-bytes size warning on `.osf` save (§6.1).
6. **Capabilities + menus** (§8) and polish (opacity control, lock/hide,
   z-order, delete key, context menu).

## 10. Testing

- **Unit:** `.osf` v2→v3 migration; images round-trip (incl. dedup); export-loss
  registry returns correct features per format; image transform math (resize,
  rotate-snap, crop UV mapping); CPU hit-test on rotated/cropped rects.
- **Renderer:** image program draw-order and transform correctness (existing
  adapter tests are the model).
- **Browser (author-verified):** drop an image, move/resize/rotate (with Shift
  snap + aspect), crop; save `.osf` → reload → identical; export `.cp`/`.fold`
  → warning shown, file has no image data; open a v3 `.osf` in the current app.

## 11. Risks — resolved

- **Very large images / VRAM** → **resolved by the import cap** (§1.1, §3.3):
  downscale to 2048 px once, at import; no full-res copy is kept. Bounds both
  texture memory and file size. Verify on an integrated-GPU machine during
  Phase 2.
- **`.osf` size** → **cap + content-aware re-encode** (JPEG-unless-transparent,
  §1.1) keeps typical projects small; **dedup by hash** removes repeats; a
  **soft, non-blocking total-bytes warning** on save (§6.1) covers the tail. An
  external/zip container remains a future escape hatch if base64 ever bites.
- **sRGB / color management** → **explicit non-action**: sample raw sRGB bytes
  with linear filtering and blend in the usual space — identical to how a plain
  `<img>` looks, which is the bar ("reads reasonable"). Do **not** use an
  sRGB-linearizing texture format. Revisit only if color-critical tracing comes
  up.

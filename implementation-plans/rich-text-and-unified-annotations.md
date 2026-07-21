# Rich Text & Unified Canvas Annotations

## Goal

Deliver a rich, WYSIWYG text-annotation experience on the crease-pattern
canvas and, in the process, unify how **text** and **images** behave as
first-class canvas objects.

Concretely:

- Text lives in a **drag-to-resize box** whose content **reflows**, edited
  through a **WYSIWYG** editor (bold / italic / underline, block/text-type
  presets, color, alignment) surfaced in a **floating toolbar above the box**.
- Text behaves exactly like images: **click selects + highlights, drag moves,
  double-click edits** — no tool required.
- Image options (opacity, bring-to-front / send-to-back, delete) move from the
  **pinned top-center pill** to the **same floating-above-the-object toolbar**.
- The floating toolbar is a **generic, reusable component** for future use.
- Full rich model is persisted in **`.osf`**; on **`.ori`/`.fold`** export it
  **flattens to Oriedita-compatible `{x, y, text}`** and inflates back on import.

## Approach

### Guiding principle: annotations are a web-side concept; the kernel stays a faithful port

Today text and images sit on opposite sides of an architectural seam:

- **Text** is kernel-owned — `TextElement { x, y, text }` in `oristudio-cp`
  (`crates/oristudio-cp/src/model/mod.rs:243`), edited through kernel commands
  (`execute_text_command`) and rendered by a DOM overlay (`CpTextOverlay.tsx`).
  Only three fields exist; there is no style anywhere.
- **Images** are web-only — the rich `CpImage`
  (`apps/web/src/cp-workspace/images/cpImage.ts:45`) never touches the kernel,
  renders as a WebGL quad, and is `.osf`-only by design.

We adopt the **image model as the template**: rich text becomes a web-side
object, and the Rust `TextElement` is **demoted from "the model" to "an
interchange codec"** — inflated on Oriedita import, flattened to on Oriedita
export, otherwise idle. This keeps the Rust kernel a faithful Oriedita 5.0.1
port (per `PORTING.md` / `AGENTS.md` porting discipline) while letting `.osf`
carry the full rich model. It also makes "text behaves like images" fall out of
a shared substrate instead of being bolted on.

### Unified annotation substrate

Introduce a single web-side annotation concept with a shared base and
kind-tagged payloads:

```ts
interface AnnotationBase {
  id: string;
  center: { x: number; y: number }; // model coords
  width: number;                    // model units
  height: number;                   // model units (auto-derived for text in auto mode)
  rotation: number;                 // radians, CCW about center
  z: number;                        // unified draw/stack order
  opacity: number;                  // 0..1
  locked: boolean;
  hidden: boolean;
}

interface ImageAnnotation extends AnnotationBase {
  kind: 'image';
  src: string; naturalWidth: number; naturalHeight: number; crop: CpImageCrop;
}

interface TextAnnotation extends AnnotationBase {
  kind: 'text';
  doc: SerializedEditorState; // Lexical document state (JSON)
  plainText: string;          // cached flatten (for .ori codec + measurement/hit fallback)
  autoHeight: boolean;        // height grows with content vs. fixed
}

type CanvasAnnotation = ImageAnnotation | TextAnnotation;
```

`ImageAnnotation` is today's `CpImage` plus a `kind` tag — near-zero churn to
image geometry/rendering. The store holds **one** `annotations` array so
z-order, selection, the floating toolbar, and drag/resize/rotate are shared.

### Rendering split (a deliberate, documented constraint)

- **Images** keep the WebGL textured-quad path (`imageProgram.ts`); the renderer
  filters `annotations` to `kind === 'image'`.
- **Text** renders as a **DOM overlay** (browser handles reflow/fonts/marks for
  free). A Lexical editor renders read-only when idle and becomes editable on
  double-click. Box width (model units → screen px via the camera) drives
  reflow; text-type presets set font size in model units so it scales with zoom.
- **Constraint:** DOM always paints above the `<canvas>`, so in the unified
  z-order **text always sits visually above images** (text↔text and image↔image
  order correctly; text-behind-image is not achievable without a GPU glyph atlas
  — explicitly out of scope). This matches the "labels over a diagram" use case.

### Global, tool-free selection

- Remove `oristudioCpImageEditMode` and the "Images tool" gate. A shared
  **annotation interaction overlay** (SVG handles + hit-testing) is live whenever
  the **Select/pointer** context is active (and inert while a crease-draw tool is
  active, so crease clicks are never stolen).
- Click → select + floating toolbar; drag → move; handles → resize/rotate;
  double-click text → Lexical edit; double-click image → crop (existing).
- **Creation** tools only: Text tool = click to drop a new box (opens editor
  immediately); images arrive via drag-drop / menu. No selection tool needed.

### Generic floating toolbar

`FloatingToolbar` — a presentational, body-portaled pill (`role="toolbar"`,
reusing the `.cp-image-inspector` visual recipe) positioned above an anchor rect
with collision-aware flip/shift via **`@floating-ui/react`** (new dep; the
standard primitive, also backs future popovers). A thin
`annotationScreenRect(view, annotation)` adapter turns a model-space annotation
into the screen anchor and re-projects on `onViewChange` like existing overlays.

Composed toolbars:

- **Shared annotation actions** group: opacity, bring-to-front / send-to-back,
  delete, lock/hide (lock/hide already exist on the model).
- **Image** toolbar = shared group only (migrated from `CpImageInspector`,
  now anchored instead of pinned).
- **Text** toolbar = shared group + text controls (block-type `Select`, B/I/U
  toggles, color swatch, alignment `SegmentedControl`).

### Serialization

- **`.osf` (schema v4):** `creasePattern.annotations: CanvasAnnotation[]`
  replaces `images`. Text docs stored as Lexical JSON. Migration v3→v4: map
  `images` → image annotations, and inflate any kernel-snapshot `texts` →
  default-styled text annotations. Keep reading v3.
- **`.ori`/`.fold` export:** flatten each `TextAnnotation` (walk Lexical state →
  concatenate text nodes, `\n` between blocks, drop marks) → `{x, y, text}`, push
  into the kernel via a new WASM `set_texts(handle, coords, texts)` helper, then
  call the existing exporter (`export_ori` / `export_fold`). Images remain
  omitted. Choke points unchanged: `io/ori.rs:376`, `io/fold.rs:384`.
- **`.ori`/`.fold` import:** kernel `texts` → inflate to default-styled text
  annotations; kernel texts then treated as consumed (single source of truth is
  the annotations array).

### Undo/redo

Extend the existing image-only history channel (`recordCpImageHistory`,
`imageOnly` entries) into a unified **annotation history** channel covering both
kinds, so text edits, moves, resizes, and style changes are undoable alongside
image edits. Retire the kernel text-command history path for editing.

## Affected Areas

- **New (web):**
  `apps/web/src/cp-workspace/annotations/` — `annotation.ts` (types/factories),
  `annotationPlacement.ts` (transform/hit-test/resize, generalized from
  `cpImagePlacement.ts`), `textDoc.ts` (Lexical config + flatten/inflate codec).
  `apps/web/src/components/ui/FloatingToolbar.tsx` + `annotationScreenRect`.
  `apps/web/src/cp-workspace/AnnotationOverlay.tsx` (shared selection/handles),
  `CpTextAnnotation.tsx` (Lexical DOM renderer/editor),
  `AnnotationToolbar.tsx` / `ImageToolbar.tsx` / `TextToolbar.tsx`.
- **Refactor (web):**
  `store/workspaceStore/slices/creasePatternSlice.ts` + `types.ts`
  (`oristudioCpImages` → `oristudioCpAnnotations`, unified selection + history);
  `components/panels/CreasePatternPanel.tsx` (wiring, remove image-edit-mode
  gating, mount unified overlay/toolbars); retire `CpImageOverlay.tsx`,
  `CpImageInspector.tsx`, `CpTextOverlay.tsx` (fold into the unified components);
  `cp-workspace/renderer/reglRenderer.ts` + `CpRenderer.ts` (filter image
  annotations); tool registry / `oristudioCpActions.ts` (Text tool becomes
  creation-only; remove Images tool).
- **Serialization (web + wasm):**
  `lib/nativeProjectFile.ts` (v4 schema + migration),
  `lib/creasePatternImport.ts` (import inflate), Oriedita export wiring;
  `crates/oristudio-cp-wasm/src/lib.rs` (`set_texts` bridge).
- **Deps:** add `lexical` (+ `@lexical/react`, needed nodes) and
  `@floating-ui/react` to `apps/web/package.json`.
- **Styles:** `apps/web/src/styles/theme.css` (FloatingToolbar pill, text box,
  edit affordances; retire pinned `.cp-image-inspector` positioning).
- **Docs:** `PORTING.md` note on the text-flatten codec; this plan.

## Checklist

### Phase 0 — Reusable floating toolbar (ship-able, no model change)
- [x] Add `@floating-ui/react`; build generic `FloatingToolbar` (portal, flip/shift).
- [x] Add `annotationScreenRect` anchoring helper (+ unit tests).
- [x] Migrate `CpImageInspector` → anchored `FloatingToolbar` instance above the image.

### Phase 1 — Unified annotation substrate (images only, behavior-preserving)
- [x] Introduce `CanvasAnnotation` / `AnnotationBase` / `ImageAnnotation` types.
- [x] Refactor store slice: `oristudioCpImages` → `oristudioCpAnnotations`, shared selection + history.
- [x] Generalize placement/hit-test/resize (widened `cpImagePlacement`, `annotationAnchor`).
- [x] Renderer consumes filtered image annotations; image render output unchanged.
- [x] Remove Images tool / `imageEditMode`; image selection global under Select context.
- [x] `.osf` in-memory rename (disk format unchanged this phase).

### Phase 2 — Rich text object
- [x] Add `lexical`; define `textAnnotation` model + `textFormatting` (marks, block presets, color, align).
- [x] `CpTextView` read-only renderer + `CpTextEditor` (Lexical) with reflow in a resizable box.
- [x] Text creation tool (drop box → edit); double-click-to-edit; select/drag/resize via shared `CpAnnotationOverlay`.
- [x] `TextToolbar` (block type, B/I/U, color, alignment) + shared `AnnotationActions`.
- [x] Retire `CpTextOverlay` / kernel text-edit commands.
- [x] `.osf` v4: additive `textAnnotations` field persists text boxes (+ round-trip tests).
- [ ] Inflate legacy kernel `texts` → text annotations on load (**deferred to Phase 3** — needs a kernel "clear texts" op; until then, legacy files with kernel texts don't display them).

### Phase 3 — Oriedita serialization codec
- [x] Flatten (Lexical → `{x,y,text}`, `flattenTextAnnotations`) + `set_texts` WASM bridge; wire `.ori`/`.fold`/`.orh` export (worker sets texts → exports → restores empty). Internal fold projection stays text-free.
- [x] Inflate kernel `texts` → default text annotations on import (`.cp`/`.ori`/`.fold`/`.orh`), clearing the kernel copy so `.osf` save doesn't double-count. Closes the Phase 2 gap.
- [x] Flatten unit tests; kernel text round-trip already covered by `io/ori.rs` / `io/fold.rs`.

### Phase 4 — Unification polish
- [ ] Unified annotation undo/redo across text + image edits.
- [ ] Keyboard: arrow-nudge, delete, escape; z-order UX.
- [ ] Lint / typecheck / web unit tests / wasm build; `PORTING.md` codec note.

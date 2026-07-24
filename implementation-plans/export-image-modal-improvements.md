# Export Image Modal Improvements

## Goal

Turn the SVG/PNG export dialog from a "render one crease pattern to a 1024²
square" utility into a small composition tool:

1. **Pattern thumbnails** — when the document has more than one crease pattern,
   pick the pattern from a scrolling column of *rendered* CP thumbnails on the
   left (like `SimulatorSegmentsSidebar`), not a wall of "Pattern N" pills.
2. **Dark / light export theme** — a toggle that renders the exported image with
   a dark or light palette. Defaults to **light** regardless of app theme.
3. **Folded figure** — optionally fold the selected pattern and place the folded
   figure to the right of the crease pattern in the exported image.
4. **Title / subtitle / description** — optional text drawn into the exported
   image above (title, subtitle) and below (description) the artwork.

Decisions taken with the user up front:

- The folded figure is the **Oriedita exact flat-folded figure** (the CP
  kernel's folded form), not a 3D origami-simulator render.
- The folded figure is offered **only when a single pattern is selected**; in
  "All patterns" mode the toggle is disabled with a reason.
- The export theme **always defaults to light**; dark is an explicit opt-in per
  export.

## Current state

| Piece | Where |
| --- | --- |
| Dialog UI (all dialog types) | `apps/web/src/components/CommandDialogModal.tsx` |
| Dialog request/resolve plumbing | `apps/web/src/store/commandDialogStore.ts` |
| SVG/PNG renderer | `apps/web/src/lib/creaseExport.ts` |
| Export command | `apps/web/src/store/workspaceStore/slices/projectSlice.ts` (`resolveCreaseExport`, `exportSvg`, `exportPng`) |
| Segmentation + thumbnails | `apps/web/src/lib/creasePatternSegmentation.ts` (`segmentFoldDocument`, `segmentThumbnailSvg`, `pointInSegment`) |
| Folded-figure kernel calls | `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts` (`foldOristudioCpDocument`, `getOristudioCpFoldedFigureRenderSnapshot`, `freeOristudioCpFoldedFigure`) |
| Folded render snapshot types | `apps/web/src/engine/oristudioCpTypes.ts` |
| Folded placement/bounds helpers | `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` (`placeFoldedFigureBesideCp`, `cpUserAnchorForLineIds`, local geometry/bounds) |
| Modal styles | `apps/web/src/styles/theme.css` (`.export-modal*`, `.segments-sidebar`, `.segment-card`) |

Facts that shape the design:

- `serializeCreasePatternSvg` hard-codes a 1024×1024 viewBox, a white page fill
  (`#ffffff`), a paper fill (`#f8f5ec`), and per-assignment stroke colors, and
  `svgToPng` hard-codes a 1024×1024 canvas. Any of title text, description text,
  or a side-by-side folded figure breaks the fixed square.
- Export is enabled whenever the workspace *has* a crease pattern
  (`canExportCreasePattern` in `workspaceCapabilities.ts`) — including a
  TreeMaker design with **no editable CP document**. Folding needs the CP kernel
  handle, so the folded-figure option must be gated on
  `hasEditableCreasePattern`.
- The kernel folds a **selection**: `folded_figure_fold_selected(handle,
  lineIds, …)`. Folding "just this pattern" therefore means "fold the line ids
  that belong to that segment".
- For an editable CP, `foldArtifacts.fold` is produced by
  `parseFoldProjection(exportOristudioCpDocumentAsFold())` — its coordinates are
  the kernel's own model coordinates, the same space as
  `document.crease_pattern.line_segments`. That is what makes a geometric
  segment → line-id mapping viable.
- Folded render snapshots are declarative drawing primitives (paths, segments,
  polygons, rects, ellipses, text with paint/stroke styles) in CP **SVG user
  coordinates**, so they serialize to SVG directly — no tessellation needed.
- No user-supplied text is written into an export today, so there is no XML
  escaping anywhere in `creaseExport.ts`. A title containing `&` would emit
  invalid SVG.

## Approach

### Guiding rule: the preview is the contract

The exported file must be byte-for-byte the thing the preview showed. That
matters most for the folded figure, which is an async kernel call that can fail
or hit a flat-foldability contradiction: the export must **reuse the folded
snapshot already computed for the preview**, never refold at export time.

So the dialog resolves a *pair* — declarative `options` plus resolved `content`
(currently just the folded snapshot) — and both flow into the serializer.

### 1. Renderer foundation (`lib/creaseExport.ts`)

Extend the options type:

```ts
export type CreaseExportTheme = 'light' | 'dark';

export interface CreaseExportCaption {
  title: string;
  subtitle: string;
  description: string;
}

export interface CreaseExportOptions {
  segmentId: number | null;
  lineStyle: OristudioCpLineStyle;
  lineWidth: number;
  pointSize: number;
  includeUnassigned: boolean;
  showBackgroundColor: boolean;
  theme: CreaseExportTheme;          // new
  includeFoldedFigure: boolean;      // new
  caption: CreaseExportCaption;      // new
}

/** Resolved, non-declarative content the preview already computed. */
export interface CreaseExportContent {
  foldedFigure: OristudioCpFoldedRenderSnapshot | null;
}
```

`serializeCreasePatternSvg(fold, segments, options, content?)` and
`renderCreasePatternPng(…, content?)` take the extra argument; omitting it means
"crease pattern only", which keeps every existing programmatic caller working.

**Palette.** Replace the module-level `ASSIGNMENT_COLOR` map and the literal
`#ffffff` / `#f8f5ec` / `#111417` with a `CreaseExportPalette` record selected by
`options.theme`:

```ts
interface CreaseExportPalette {
  canvas: string;      // page background
  paper: string;       // facet fill
  mountain, valley, border, flat, unassigned: string;
  point: string;
  monochromeInk: string;   // the "black" of the black-* line styles
  monochromeValley: string;// its muted counterpart (black-white valley)
  text: string;
  textMuted: string;
}
```

Light keeps today's exact values, so existing exports do not change. Dark uses a
near-black canvas, a dark slate paper fill, and brightened M/V hues.
`edgeAppearance()` takes the palette instead of closing over constants —
critically, the three monochrome line styles (`black-white`, `black-one-dot`,
`black-two-dot`) must invert their ink to a light gray in dark mode or they draw
black-on-black.

Folded-figure primitives carry kernel-assigned colors (white paper, black
outline). Render them **verbatim in both themes**: the folded figure is a picture
of paper, and it reads correctly on either canvas. Note it in a comment so a
later reader does not "fix" it.

**Layout engine.** Add a pure, testable layout pass:

```ts
interface CreaseExportLayout {
  width: number;
  height: number;
  cp: Rect;                 // where the crease pattern draws
  folded: Rect | null;      // where the folded figure draws
  titleLines / subtitleLines / descriptionLines: TextLine[];
}
function layoutCreaseExport(input): CreaseExportLayout
```

- Content box for the CP stays **1024×1024**, so a plain CP export is
  pixel-identical to today.
- Folded figure sits to the CP's right with a fixed gap, vertically top-aligned
  (mirroring `placeFoldedFigureBesideCp`'s "read as a row" rule), scaled to fit
  the same 1024 height at the CP's own scale so the two are comparable in size.
- Title/subtitle stack above the artwork, description below; each block
  contributes height only when non-empty (no blank bands).
- Text wrapping: SVG has no auto-wrap and `canvas.measureText` is unavailable in
  the vitest environment, so wrap with a deterministic width estimator
  (`wrapExportText(text, maxWidth, fontSize)` using a per-font average advance
  ratio). Approximate but reproducible, which is the property that matters.
- Font stack: system UI stack only (`-apple-system, "Segoe UI", Roboto, …`). No
  webfonts — the SVG → `<img>` → canvas rasterization path cannot load them.

**Correctness fixes that come with this:**

- `escapeXml()` for every caption string and every folded-figure `text`
  primitive.
- Emit explicit `width`/`height` on the root `<svg>` alongside the viewBox —
  non-square SVGs rasterize unpredictably from intrinsic size alone.
- `svgToPng` takes the layout's width/height instead of the `SIZE` constant.

### 2. Folded-figure SVG serializer (`lib/foldedFigureSvg.ts`, new)

Maps `OristudioCpFoldedRenderSnapshot` primitives to SVG:

| primitive geometry | SVG |
| --- | --- |
| `path` | `<path d="…">` built from move/line/quad/cubic/close |
| `segment` | `<line>` |
| `polygon` | `<polygon>` (fill) / `<polyline>` (stroke) |
| `rect` / `ellipse` | `<rect>` / `<ellipse>` |
| `text` | `<text>` (escaped) |

Paint: `color` → `fill`/`stroke` with `fill-opacity` from alpha; `gradient` →
a real `<linearGradient>` def (SVG supports it natively — better than
`cpFoldedToScene`'s from-color approximation, which exists only because WebGL
cannot); `texture` / `other` → skip. Stroke: `basic` → `stroke-width` plus
cap/join mapping.

Also export `foldedFigureSnapshotBounds(snapshot)`. Reuse the existing local
bounds pass from `cpFoldedToScene.ts` (extract it rather than writing a second
one) so the export and the canvas agree on a figure's extent.

### 3. Ephemeral fold for export (`lib/creaseExportFold.ts`, new)

```ts
export async function foldSegmentForExport(
  document: OristudioCpDocument,
  fold: FoldDocument,
  segment: CpSegment,
): Promise<OristudioCpFoldedRenderSnapshot>
```

1. Map segment → CP line ids: test each `crease_pattern.line_segments` midpoint
   with `pointInSegment(segment, midpoint)` (the helper already exists "for
   export"), then filter through `selectedFoldableCpLineIds` so unfoldable line
   kinds drop out.
2. `foldOristudioCpDocument(1, 'Order5', model, lineIds)` — the same runtime
   entry point the canvas fold uses, with the model seeded from Oriedita
   metadata exactly as `foldOristudioCpDocument` in `creasePatternSlice` does.
3. `getOristudioCpFoldedFigureRenderSnapshot(handle, 'Paper5', { display_mark:
   false, selected: false })`.
4. `freeOristudioCpFoldedFigure(handle)` in a `finally`.

This path is deliberately **outside the store**: no folded-figure entry, no
undo entry, no `dirty` flag, no canvas side effects. It is a pure "give me a
picture" call, and the handle is always freed.

It also deliberately does **not** reuse a folded figure already sitting on the
canvas: those carry user placement, display style, and possibly an advanced fold
case, so exports would silently differ between sessions.

### 4. Dialog plumbing (`store/commandDialogStore.ts`)

```ts
export interface CreasePatternExportDialogOptions {
  title: string;
  format: CreaseExportFormat;
  fold: FoldDocument;
  segments: CpSegment[];
  initialOptions: CreaseExportOptions;
  /** Null when the workspace has no editable CP (e.g. a TreeMaker design). */
  foldedFigure: {
    fold: (segment: CpSegment) => Promise<OristudioCpFoldedRenderSnapshot>;
  } | null;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface CreaseExportDialogResult {
  options: CreaseExportOptions;
  content: CreaseExportContent;
}
```

`requestCreasePatternExportOptions` resolves `CreaseExportDialogResult | null`;
the `pending` union, `resolveCommandDialog`, and the "no host mounted" fallback
update accordingly. Injecting the fold function keeps `CommandDialogModal`
presentational and lets its tests supply a fake folder with no wasm.

`projectSlice.resolveCreaseExport` supplies the callback only when
`get().oristudioCpDocument` exists, seeds `caption.title` from
`get().project.title`, and returns `{ options, content, fold, segments }` for
`exportSvg` / `exportPng` to hand to the renderer.

### 5. Modal UI (`components/CommandDialogModal.tsx`)

Three columns when `segments.length > 1`, two otherwise:

```
[ pattern thumbnails 132px ] [ preview 1fr ] [ controls 300px ]
```

**Left column (new).** A scrolling `role="listbox"` of rendered thumbnails: an
"All patterns" entry first, then one per segment with its index badge. Built on
`segmentThumbnailSvg`, generalized to `cpThumbnailSvg(fold, segments[], {
size, palette })` so it can (a) render the all-patterns composite and (b) follow
the export theme; `segmentThumbnailSvg` stays as a thin wrapper so
`SimulatorSegmentsSidebar` is untouched. The pattern pill list is deleted.

**Right column.** Existing controls, plus:

- *Theme* — a two-option `SegmentedControl` (Light / Dark).
- *Include folded figure* — a `Toggle`, disabled with an explanatory hint when
  the workspace has no editable CP, or when "All patterns" is selected.
- *Text* group — Title input, Subtitle input, Description textarea.

**Folded-figure preview state.** Selecting a pattern with the toggle on kicks
off `foldSegmentForExport`, keyed by `(segmentId, cpRevision)` and cached for the
dialog's lifetime; the preview keeps drawing the CP with a "Folding…" note while
it runs. A fold error (unfoldable selection, kernel error) shows an inline
message and switches the toggle off, so preview and export never disagree.

**Preview performance.** Caption edits re-serialize on every keystroke today.
Split the memo: the CP body and the folded body memoize on their own inputs, and
only the caption/layout wrapper recomputes as the user types.

### 6. Styles (`styles/theme.css`)

`.export-modal` grid gains the thumbnail column (`grid-template-columns` driven
by a `--export-modal--with-patterns` variant class);
`.export-modal__preview img` drops `aspect-ratio: 1` for `max-height` +
`object-fit: contain` so a wide, folded-figure export previews correctly. New
`.export-modal__patterns` (scroll column) reuses the `.segment-card` visual
language. `.simple-modal__document--export` widens.

### 7. i18n

New `dialogs:export.*` strings: theme label + Light/Dark, folded-figure label +
the two disabled reasons + folding/error states, title/subtitle/description
labels and placeholders, thumbnail list aria labels. Then the required loop:
`npm run i18n:extract` → translate all 8 locales → `npm run i18n:stamp` →
`npm run i18n:check`.

## Affected Areas

- `apps/web/src/lib/creaseExport.ts` — palette, layout engine, captions, folded
  composition, escaping, dynamic PNG size
- `apps/web/src/lib/foldedFigureSvg.ts` *(new)*
- `apps/web/src/lib/creaseExportFold.ts` *(new)*
- `apps/web/src/lib/creasePatternSegmentation.ts` — generalized thumbnail helper
- `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` — extract shared bounds
- `apps/web/src/store/commandDialogStore.ts` — dialog options + result shape
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — defaults, fold
  callback, content passthrough
- `apps/web/src/components/CommandDialogModal.tsx` — three-column export layout
- `apps/web/src/styles/theme.css` — export modal + thumbnail column
- `apps/web/public/locales/**` + `dialogs` namespace
- Tests: `creaseExport.test.ts`, `CommandDialogModal.test.tsx`, new
  `foldedFigureSvg.test.ts`, `creaseExportFold.test.ts`

Not touched: the Tauri shell (export goes through the shared file service), the
Rust engine, and the simulator.

## Risks / open points

- **Segment → line-id mapping** is geometric (midpoint containment). It is the
  one genuinely fragile step; it gets its own unit test on a two-pattern fixture,
  and a fold with zero mapped lines surfaces as the inline "could not fold this
  pattern" state rather than a silent empty figure.
- **Fold latency.** A dense CP can take a noticeable moment to estimate. The
  preview stays interactive and the CP renders immediately; only the figure
  waits.
- **Text metrics are approximate.** Wrapping uses an estimator, so a long
  description may wrap a word early or late. Acceptable; exact metrics would mean
  DOM measurement in the render path.
- **PNG scale.** Output stays 1× (1024-tall content) to avoid surprising file
  sizes. A resolution control is a natural follow-up but is out of scope here.

## Checklist

### Phase 1 — Renderer foundation (done)
- [x] Add `CreaseExportTheme`, `CreaseExportCaption`, `CreaseExportContent`; extend `CreaseExportOptions` and `DEFAULT_CREASE_EXPORT_OPTIONS`
- [x] Introduce `CreaseExportPalette` (light = today's colors, dark = new); thread it through `edgeAppearance`, facets, points, and monochrome line-style inversion
- [x] Add `escapeXml` and use it for every user-supplied string
- [x] Add `layoutCreaseExport` + `wrapExportText`; emit root `width`/`height`; make `svgToPng` use the layout size
- [x] Render title/subtitle/description blocks
- [x] Unit tests: dark palette, monochrome inversion, caption escaping, empty-caption layout unchanged from today, wrapping

### Phase 2 — Modal restructure + theme + captions (done)
- [x] Generalize `segmentThumbnailSvg` → `cpThumbnailSvg(fold, segments[], { size, palette })`; keep the simulator wrapper
- [x] Three-column export modal with the scrolling thumbnail listbox (incl. "All patterns"); delete the pill list
- [x] Theme `SegmentedControl` wired to `options.theme`
- [x] Title / subtitle / description fields, title prefilled from the project title
- [x] Split preview memoization so typing does not re-serialize the CP
- [x] CSS: pattern column, wider document, non-square preview
- [x] Modal tests: thumbnail selection drives `segmentId`, captions reach the resolved payload

### Phase 3 — Folded figure (done)
- [x] Folded-figure bounds computed from the render primitives in `foldedFigureSvg.ts` (the canvas path's cached geometry is tessellated for WebGL, so there was nothing worth sharing)
- [x] `lib/foldedFigureSvg.ts` primitive → SVG serializer (+ tests)
- [x] `lib/creaseExportFold.ts`: segment → line ids, ephemeral fold, snapshot, guaranteed handle free (+ tests, including free-on-error)
- [x] Dialog options carry the fold callback; result becomes `{ options, content }`; update `commandDialogStore`, `projectSlice`, existing tests
- [x] Toggle + gating (no editable CP / All patterns), "Folding…" and error states, per-segment snapshot cache
- [x] Compose the folded figure into the export layout to the right of the CP; export reuses the previewed snapshot
- [x] Modal tests with a fake folder: enabled/disabled gating, error path turns the toggle off
- [x] Collapsible folded-figure options: side, front/back colour, fold case (kernel model per fold; case reached with `fold_to_case` on the ephemeral handle)
- [x] Fixed modal working height so a twenty-pattern document does not stretch it to the viewport

### Phase 4 — i18n + validation
- [ ] Inline English for all new strings; `npm run i18n:extract`
- [ ] Translate the 8 locales; `npm run i18n:stamp`; `npm run i18n:check` passes
- [ ] `cd apps/web && npx tsc --noEmit`, `npm run lint:web`, `npm run test:web`
- [ ] Browser check (Zach): multi-pattern thumbnails scroll + select; dark export; folded figure aligns and matches the preview; PNG renders caption text; single-pattern layout unchanged

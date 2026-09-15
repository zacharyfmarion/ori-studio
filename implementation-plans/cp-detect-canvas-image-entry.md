# Detect crease patterns from images on the Edit canvas

## Goal

When an image that looks like a crease pattern lands on the Edit canvas — by
drop, by Insert ▸ Image, or from the canvas context menu — offer to detect it,
right there on the image, and take the user into the existing Detect dialog
with that image already loaded. The offer must almost never appear on the
things people actually put on this canvas as references (photos of folded
models, diagram pages, text), must never block or slow the drop, and must be
one click to dismiss.

Once the pattern is detected, it should land **on** the image, with the image
demoted to a locked half-opacity underlay behind it — the same relationship
Review & Fix already builds for its own rectified underlay — rather than beside
the current pattern with the image left where it was.

The pill is the only new entry point. File ▸ Detect CP from Image… stays as
the manual path for the patterns the gate misses; an explicit verb on the
selected image is deferred (see *Deliberately out of scope*).

## Evidence the gate can be cheap

Measured on 2026-09-14 (memory: `cp-detect-canvas-image-gate-evaluation`).
Negatives are the scrape pipeline's Gemini-labelled rejects — 948 photos of
folded models, plus multi-panel pages, diagrams, hand-drawn sketches, text —
which is exactly the distribution of a reference image on this canvas.
Positives are the designer sets, the curated cases, the clean renders and the
Gemini-accepted crops. ~190 synthetic non-origami line images (graph paper,
cutting mats, tables, charts, floor plans, flowcharts, text, brick/plaid,
random line art) stand in for the negatives the corpus lacks. Held-out 30%:

| Model | AUC | Recall @ thr 0.7 | FPR: folded-model photos | FPR: photos, text, tables, plans, charts | FPR: evenly spaced grids |
|---|---|---|---|---|---|
| 20 hand features, 60–100 trees depth 3 | 0.98 | 92% (designer sets 93%) | 2% | 0% | 20–35% |
| 31 hand features, 300-iteration ensemble | 0.989 | 94% | 1% | 0% | 18% |
| Tiny CNN from scratch, 60k params, 256 px | 0.976 | 79% at 3.6% FPR | — | grids 93%, patterns 60% | — |
| `auto_rectify_rgba` report signals alone | 0.96 | not usable as a gate | | | |
| ML repo `crop_detector.py` `cp_score` | 0.75 | | | | |

Three consequences shape the design:

- **No model download, no ONNX Runtime.** Hand features plus a shallow tree
  table beat a from-scratch CNN on this data and cost ~55 ms in Python at
  512 px (thinning is half of it); the Rust port should be 10–20 ms.
- **The features that carry the weight are structural**, which is why they
  transfer: total straight-line length, the share of skeleton pixels that are
  dangling endpoints (creases end at other creases: ~0 for a CP, 5–20% for
  anything else), gradient orientations on a 22.5° lattice, diagonal mass, and
  the share of line length in full-width segments (which is what rejects grids
  and blinds).
- **Evenly spaced grids are the honest residual** — a grid *is* a precrease
  pattern — and we accept that rather than chase it. Everything else a user is
  likely to drop scores near zero. Many of the remaining measured "false
  positives" are composites of a CP beside a rendered model, on which the offer
  is correct.

The scratch harness that produced these numbers is rebuilt properly in Phase 0
below, with the Rust extractor as the only feature implementation.

## UX

### The moment

1. The user drops `dragon-cp.png` on the Edit canvas. The image lands under the
   cursor exactly as today — nothing about the drop changes or waits.
2. Within a few hundred milliseconds a small pill fades in just below the
   image's bottom-left corner:

   ```
   ┌────────────────────────────────────────────────────┐
   │ ⌗  Looks like a crease pattern   [Detect creases]  × │
   └────────────────────────────────────────────────────┘
   ```

   It wears the `.floating-toolbar` chrome (same background, border, radius and
   shadow as the image inspector, the selection toolbar and the region chips),
   so it reads as one of the canvas's own controls and not as a notification.
   It is body-portaled and anchored through `useCanvasObjectAnchor`, so it
   stays glued to the image through pan, zoom and a drag of the image itself.
3. **Detect creases** opens the Detect dialog already on its crop step, with
   the image loaded and the auto-crop's quad drawn. The pill hides while the
   dialog is open.
4. **×** ("Not now") removes the pill for this image. It does not come back
   for that image in this session. Nothing is written to the document.
5. After the dialog imports, the detected pattern sits over the paper in the
   image, the image is at 50% opacity, locked and behind the creases, and the
   camera frames the paper. Undo peels the image change first, then the
   creases — the order Review & Fix already uses.

### Where the pill goes, and why

- **Below the image, `bottom-start`, 8 px gap.** The image inspector pill
  already owns `top-start` above a *selected* image. A dropped image is not
  selected, but the user will click it, and two pills on the same edge would
  collide. Distinct edges, both visible, no special casing. On collision with
  the pane edge `@floating-ui` flips it to the top; that is the only case in
  which the two can overlap, and it is rare and harmless.
- **Not a title bar.** The region chip spans its box's width because the box
  is inert and the bar is its only handle. An image already has its own
  selection handles; a bar as wide as a 1,200 px image with one sentence on it
  would be the wrong shape. A content-sized pill through `FloatingToolbar`
  (with `boundary` set to the pane and `wheelTarget` forwarding scroll to the
  canvas, like every other floating control) is the right one.
- **No auto-focus.** The pill must not take focus from the canvas: a user
  mid-flow keeps their keyboard where it was. The pill's container is
  `aria-live="polite"` with an accessible name, so a screen reader hears the
  offer once; its two controls are ordinary focusable buttons.
- **150 ms opacity fade in, none under `prefers-reduced-motion`.** No layout
  shift is possible: it is portaled.

### When the pill appears (all must hold)

- The image was **added in this session** — never for images loaded from a
  saved `.osf`. Those were placed deliberately, and re-prompting on every
  open is a nag; File ▸ Detect CP from Image… remains for them.
- `cpDetectAvailableHere()` — the detect build flag is on and this is not a
  phone (the dialog has no phone layout, so the offer would lead nowhere).
- The **setting** "Suggest detecting crease patterns in images added to the
  canvas" is on (default on; General ▸ Models section).
- The image's shorter side is at least 256 px before capping. Smaller than
  that the detector cannot work anyway.
- The score cleared the threshold. Borderline scores get no pill.
- The worker answered. A scoring failure of any kind is silent to the user
  (one `reportError` per session at most) — a reference image must never
  produce an error toast because a *suggestion* failed.

### What the pill does not do

- It does not persist. Dismissal is a transient map keyed by annotation id
  (score, verdict, `pending | dismissed | accepted`). Undo of the add removes
  the annotation and with it the pill; redo brings the annotation back and the
  map still says what the user decided. No `.osf` schema change.
- It does not go away because the dialog was cancelled. Closing the dialog
  without importing puts the offer back where it was, still one click to
  dismiss; only × and a completed import retire it. Without an explicit verb
  on the image, a consumed offer would leave no way back short of re-picking
  the file from the File menu.
- It does not mention the model download. The dialog already explains and
  gates the one-time 45 MB download; the pill is an invitation, not a
  contract.
- It adds no keyboard shortcut and no `keydown` handler anywhere (AGENTS.md).

### Polish worth doing, in order

- **Warm the worker on `dragover`.** An image-only drag hovers the viewport
  for well over the worker's cold start before the drop lands. Kicking
  `getCpDetectClient()` on the first image-only `dragover` makes the pill
  appear effectively with the drop. Never at app start: most sessions never
  need the worker.
- **Third dismissal in a session** shows one toast: "You can turn off these
  suggestions in Settings ▸ General." Cheap, and it is how a user who never
  wants this finds the switch without a "don't ask again" control cluttering
  a 28 px pill.
- **Respect the crop.** If the user cropped the image on canvas before
  pressing Detect, the dialog receives the cropped pixels.

### Deliberately out of scope

- Paste has no image path in the app at all today (`pasteClipboard` handles
  CP lines and tree nodes only). Adding one is its own feature; when it
  exists it should call `addImageFromFile` and inherit all of this for free.
- Dropping an image on the Design or Simulate workspace still shows the
  existing "drop it on the crease pattern" refusal.
- Grids. See above.
- An explicit **Detect creases** verb on the selected image (inspector pill
  and context menu), which would cover the ~8% of patterns the gate misses
  and every dismissed suggestion. Deferred; the pill and the File menu are
  the two entry points for now.

## Approach

### Phase 0 — the gate, measured (Rust + harness)

**One feature implementation, in Rust.** A Python prototype fitted the trees
above; shipping a Rust port *of* it invites drift between what was trained and
what runs. So the Rust extractor is the only implementation: the training
script consumes features the Rust binary produces, and Python only fits trees
and emits a table.

`crates/oristudio-cp-detect/src/likelihood.rs`:

- `score_crease_pattern_likelihood(rgba, width, height) -> Result<CpLikelihood, LikelihoodError>`
  returning `{ score: f32, likely: bool, features: CpLikelihoodFeatures }`.
- Pipeline on an area-averaged ≤512 px luma copy: background level from the
  luma histogram mode and `bg_frac`; ink mask as local contrast against a
  21 px median (a histogram-sliding median, or two box blurs if the eval
  shows no loss — decide with numbers, not by assumption); Canny and Sobel
  from `imageproc`; a gradient-orientation histogram with the 22.5°/45°/90°
  lattice sweeps, peak mass, diagonal mass and entropy; a **probabilistic**
  Hough segment detector (`imageproc::hough::detect_lines` is the standard
  transform and returns infinite lines, which loses the segment-length
  features that carry most of the weight — port OpenCV's `HoughLinesP`
  algorithm, ~150 lines); Zhang–Suen thinning with crossing-number endpoints
  and connected-component junction counting; 6×6 coverage uniformity; ink
  saturation. Twenty features, named as in the harness.
- `likelihood_model.rs` is **generated**: tree arrays (feature, threshold,
  children, leaf value), base score, sigmoid, and `predict(&features)`. The
  threshold constant lives next to the numbers that chose it and the date.
- Examples: `cp_likelihood_features -- manifest.jsonl` (features as JSONL, for
  training and the eval) and `cp_likelihood_score -- <image>…` (features and
  score, for diagnosing a false positive in the field).
- Wasm: `cp_detect_score_crease_pattern_likelihood(rgba, w, h)` in
  `oristudio-cp-detect-wasm`, returned as a JS object. Worker method
  `scoreCreasePatternLikelihood(image: ImageData)` beside `autoRectifyImage`.
  Desktop already keeps rectification in this worker, so the native client
  needs no new command.

`scripts/cp-detect/cp-likelihood/` (product-side eval; the ML repo owns the
datasets, this repo owns what the product runs):

- `build-manifest.py` — the labelled set: designer sets, curated, rendered
  corpus, the Gemini-accepted and -rejected crops resolved through the scrape
  manifests, the simulator photos and converted wallpapers.
- `synth-negatives.py` — the randomised structured negatives, with the
  precrease grids labelled ambiguous and reported separately.
- `fit-model.py` — reads Rust-produced features, md5 70/30 split by path, fits
  the shallow GBM with balanced weights, prints the per-group table (recall on
  designer sets and scraped positives; FPR on folded-model photos, on the
  clean origami negatives, on each synthetic class), chooses the threshold at
  ~2% folded-model FPR, and writes `likelihood_model.rs` plus a `model.json`
  twin for tests.
- A README section with the table above, refreshed by the script.

Tests: thinning and crossing number on synthetic crosses (4 endpoints, 1
junction component), lattice fit on a synthetic 22.5° star, full-span fraction
on a synthetic grid, periodicity on stripes; a fixture set under
`crates/oristudio-cp-detect/tests/fixtures/cp-likelihood/` of about a dozen
images (CPs including a dark-background one and a diamond; a folded-model
photo crop, a text page, graph paper, a photograph) with expected verdicts and
a golden features JSON with tolerances, so a refactor that moves a feature
shows up as a test rather than as a recall drop in the field.

### Phase 1 — score, pill, hand-off

**Scoring** — `cp-workspace/images/useCpDetectSuggestions.ts`, a `use*` hook
beside the image modules (AGENTS.md's table; nothing new lands in the panel):

- Subscribes to annotation adds. `addImageFromFile` returns the new
  annotation id; the hook is told about it and reads the bitmap's ≤512 px
  copy (drawn on the main thread — never transfer the 2048 px `ImageData`),
  calls the worker, and stores `{ score, likely, state }` — `state` one of
  `pending | open | dismissed | accepted` — in a transient map in a small UI
  store (the same kind as `selectionUiStore`), keyed by annotation id. The
  dialog moves it to `open` on hand-off, back to `pending` when closed without
  importing, and to `accepted` on import.
- Gates listed under *When the pill appears*. Emits `cp detect image scored`.
- Exposes `suggestions: { image, score }[]` for images that are still
  present, likely, and pending; and the verbs `acceptSuggestion(id)`,
  `dismissSuggestion(id)`.

**Pill** — `cp-workspace/images/CpDetectSuggestionPill.tsx`, rendered by a
`CpDetectSuggestionLayer` that maps over `suggestions` the way `CpRegionLayer`
maps over regions: a fragment, each pill portaled, the panel mounting one line.
`FloatingToolbar` with `placement="bottom-start"`, `boundary` the pane,
`wheelTarget` the viewport canvas. Icon, label, primary `Button`, `IconButton`
close with `aria-label` "Not now". Strings under `panels:cpDetectSuggestion.*`
via `t()`, then `i18n:extract`, the eight locales, `i18n:stamp`, `i18n:check`.

**Hand-off** — the dialog's open listener today ignores the event's detail
(`CpDetectImportModal.tsx:316`). It gains a typed detail:

```ts
window.dispatchEvent(new CustomEvent('ori-studio:detect-cp-image', {
  detail: { source: 'canvas-suggestion', annotationId, image: { src, naturalWidth, naturalHeight, crop } }
}));
```

The listener converts the data URL (cropped if the annotation is) to a Blob
and an `OpenBinaryFileResult` named "Dropped image", and calls the existing
`loadImageFile(file, source)`, which already rectifies and lands on the crop
step. `CpDetectImageSource` grows by `canvas-suggestion`. The dialog keeps
`annotationId` in its session for Phase 2, reports the close-without-import
and the import back to the suggestion store, and clears it in `resetSession`.

**Settings** — `cpDetectSuggestions` in `settingsStore` + `STORAGE_KEYS`, a
`SettingsToggleRow` in the Models section of the General tab.

**Analytics** — central layer only, taxonomy per `docs/analytics.md`:

| Event | Properties | Meaning |
|---|---|---|
| `cp detect image scored` | `verdict` (`likely`/`unlikely`), `score_bucket`, `ms_bucket` | An added image was scored. The denominator for everything below, and the field FPR by proxy |
| `cp detect suggested` | `score_bucket` | The pill was shown |
| `cp detect suggestion accepted` | `score_bucket` | Detect pressed on the pill |
| `cp detect suggestion dismissed` | `score_bucket`, `dismissals_bucket` | × pressed |
| `cp detect image loaded` | `source` gains `canvas-suggestion` | existing funnel step, now attributable to this entry |

Never the image, its size, its name or its raw score.

### Phase 2 — the pattern lands on the image

After `importAddOristudioCpText`, the added paper's bounds come from
`lastOristudioCpImportAddPlacement()`, as Review & Fix already reads them.
**Move the image, not the creases**: the annotation's centre, width and height
are free, and this is the direction the existing underlay code takes.

- **Axis-aligned paper quad** (renders, screenshots, scans — the common case):
  map `detected_source_quad` from rectifier-input pixels through the
  annotation's natural size and crop to model units, and set the annotation's
  box so that quad coincides with the paper bounds. No inset: the quad *is*
  the paper's outline in the source, unlike the rectified frame's 32 px
  convention (`cp-detect-underlay-registration`).
- **Rotated or perspective quad**: an affine box cannot match it. Replace the
  annotation's source with the rectified 1024² frame and size it with the
  existing `repairAnnotations` rule, which is exactly what Review & Fix does.
- Either way: opacity 0.5, `locked`, `z` below every annotation; one undo
  entry for the image change recorded after the crease entry so undo peels
  the image first; camera frames the paper. In `reviewAndFix` mode the
  original annotation is **replaced** by the region's rectified underlay so
  there is exactly one image, never two.
- The dialog's review step says where the pattern will go: "The pattern will
  be placed over your image." No new controls.

This phase is what makes the entry point feel designed rather than plumbed,
and it is the part most worth a browser pass with a real skewed photo and a
real cropped render before calling it done.

### Verification

- Rust: unit tests above; `cargo test -p oristudio-cp-detect`; clippy; fmt.
- Harness: `fit-model.py` reproduces the table within noise on the committed
  manifest; the chosen threshold and the four headline numbers are in the
  README and beside the constant.
- Web: vitest for the hook (gates, map lifecycle across undo/redo, the
  open → pending → accepted transitions, third dismissal), the dialog's
  detail path (data URL → `loadImageFile`, crop respected), and the settings
  toggle; lint, typecheck, `i18n:check`.
- Browser (the author owns this pass): rebuild the detect wasm
  (`build:oristudio-cp-wasm` is not enough; it is
  `build:oristudio-cp-detect-wasm`), then drop a real CP render, a photo of a
  folded model, a diagram page and a graph-paper image through a synthetic
  `DragEvent` (`browser-verify-file-open-flows`): pill on the first only;
  Detect lands on the crop step with the paper found; cancelling the dialog
  brings the pill back; × removes it; undo/redo of the add; the setting off;
  and, for Phase 2, an axis-aligned render and a skewed photo both end with
  the pattern over the paper. Screenshots in the PR.
- Desktop: `npm run check:desktop`; one manual drop in the Tauri dev app, since
  the worker path is shared but the file drop is not.

## Affected Areas

- `crates/oristudio-cp-detect/src/likelihood.rs`, `likelihood_model.rs`
  (generated), `examples/cp_likelihood_features.rs`,
  `examples/cp_likelihood_score.rs`, `tests/fixtures/cp-likelihood/`
- `crates/oristudio-cp-detect-wasm/src/lib.rs` — one export
- `scripts/cp-detect/cp-likelihood/` (`build-manifest.py`,
  `synth-negatives.py`, `fit-model.py`, README section)
- `apps/web/src/workers/cpDetectWorker.ts` — `scoreCreasePatternLikelihood`
- `apps/web/src/cp-workspace/images/` — `useCpDetectSuggestions.ts`,
  `CpDetectSuggestionPill.tsx`, `CpDetectSuggestionLayer.tsx`,
  `cpDetectSuggestionStore.ts`
- `apps/web/src/cp-workspace/annotations/useCpAnnotations.ts` — return the
  added id; warm the worker on image-only `dragover`
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — mount the layer
  (one line)
- `apps/web/src/components/CpDetectImportModal.tsx` — typed event detail,
  data-URL source, `annotationId` in the session, Phase 2 registration
- `apps/web/src/analytics/events.ts`, `docs/analytics.md`
- `apps/web/src/store/settingsStore.ts`, `lib/storage.ts`,
  `components/SettingsModal.tsx`
- `apps/web/public/locales/*/panels.json`, `dialogs.json`

## Checklist

### Phase 0 — gate
- [x] `likelihood.rs`: downscale, background, ink mask, Canny/Sobel,
      orientation lattice features, probabilistic Hough segments (the crate's
      existing OpenCV port), thinning + crossing number + junction
      components, coverage, saturation
- [x] Unit tests on synthetic masks and histograms
- [x] `cp_likelihood_features` and `cp_likelihood_score` examples
- [x] Harness: `build-manifest.py`, `synth-negatives.py`, `fit-model.py`
- [x] Fit on Rust features; per-group table reproduced; threshold pinned at
      0.8 (held-out: recall 0.89, folded-model photo FPR 0.021);
      `likelihood_model.rs` generated
- [x] Verdict tests: the clean render fixture (and its inversion) is offered;
      blank, value noise and text-like dashes are not — generated at test
      time, so no corpus image enters the repo
- [x] Wasm export and worker method; wasm rebuilt
- [x] README section with the operating-point table and the threshold's
      provenance

### Phase 1 — pill and hand-off
- [x] `cpDetectSuggestionStore` (transient map), `cpDetectSuggestions.ts`
      (the gates, scoring, silent failure) and `useCpDetectSuggestions`
- [x] The import keeps a ≤512 px preview for the gate; the hook scores after
      the add; worker warmed on image-only `dragover`
- [x] `CpDetectSuggestionPill` + `CpDetectSuggestionLayer`; `bottom-start`,
      pane boundary, wheel forwarding, live region, reduced-motion fade
- [x] Dialog: typed detail (`lib/cpDetectEntry.ts`), data-URL (cropped)
      source, `annotationId` in session, `CpDetectImageSource` extended,
      close/import reported back to the suggestion store; the upload stage
      now shows a read error instead of swallowing it
- [x] Setting + toggle row in Settings ▸ General ▸ Models; third-dismissal
      toast
- [x] Analytics events and `docs/analytics.md` rows
- [x] i18n: extract, translate all locales, stamp, check
- [x] Vitest coverage listed under Verification; lint; typecheck
- [x] Browser pass on the dev server: clean render → pill (score 0.97); the
      app's own coloured, pentagonal preview → no pill (0.56, a known miss:
      filled faces and a non-22.5° symmetry); Detect lands on the rights
      gate; cancel brings the pill back; × retires it
- [ ] Desktop drop in the Tauri dev app

### Phase 2 — registration
- [x] Axis-aligned quad → annotation box over the paper bounds
      (`cpImageRegistration.ts`, unit-tested)
- [x] Rotated/perspective quad → rectified-frame underlay via the sizing
      Review & Fix uses (`rectifiedUnderlayBox`, now shared); `reviewAndFix`
      removes the canvas image rather than doubling it
- [x] Demotion (opacity, lock, z) and one overlay undo entry after the crease
      entry; camera frames the paper as before
- [x] Review-step copy
- [x] Browser pass on the dev server: a clean render lands on the paper
      through the affine path (its own pixels kept); Review & Fix removes it
      and leaves one rectified underlay owned by the region; a real
      diamond-oriented pattern takes the rectified-frame path (1024 px JPEG
      at 1024/960 of the paper), creases over it aligned

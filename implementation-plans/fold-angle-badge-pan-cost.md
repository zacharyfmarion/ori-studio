# Fold-angle badge pan cost

## Goal

Panning a crease pattern with fold-angle labels on was visibly rough; panning
with them off was smooth. Make the badge layer cost nothing per pan frame
without removing the feature or degrading it during motion.

## Evidence

A 3.5s Chrome trace of a wheel pan (158 wheel events, 331 presented frames on a
120Hz display), profiled against a production build:

| | |
| --- | --- |
| React sync render + commit | 202.1ms (320 flushes — two per wheel event) |
| ↳ `setValueForStyle` (self) | 47.0ms — inline `transform` per badge |
| ↳ `removeChild` (self) | 45.9ms |
| Style recalc / layout / layerize / paint | ~230ms |
| Hit testing | 88.8ms (350 × 254µs) |
| **WebGL renderer, entire trace** | **7.5ms** |
| **Renderer main busy** | **758ms / 3.66s (21%)** |
| **GPU process main busy** | **2279ms / 3.66s (62%)** |

The only app components with meaningful time were `CpFoldAngleLayer` (23.2ms),
`planFoldAngleBadges` (11.0ms) and `badge` (6.1ms), and turning the labels
toggle off made the pan smooth. No forced synchronous layout anywhere.

**The trap in that table**: the itemised main-thread costs are legible and the
GPU number is one opaque blob, so the main thread reads as the problem. It was
not. Removing *all* 202ms of React changed nothing anyone could feel. The cost
was repainting 300 text nodes per frame, which is why the loaded thread was the
GPU process at 62% and not the renderer at 21%.

## Approach

Two changes, and only the pair works:

1. **Don't re-render on pan.** `CpOverlayView` is `{ origin, ex, ey }` and
   `panUserCamera` moves `origin` only, so while the basis holds every projected
   point moves by the same delta and one `translate()` on the container
   reproduces all of them exactly — the same affine, factored. Screen *lengths*
   are likewise translation-invariant, and they are what `planFoldAngleBadges`
   decides culling and level of detail on, so a pan cannot change the plan
   either. New `usePannedOverlayView` hook returns a **plan view** that changes
   only when `ex`/`ey` do, plus a ref it writes the pan offset onto directly.

2. **Promote the container** (`will-change: transform`), so that translate is a
   compositor move rather than a repaint.

(2) is what fixed it. (1) is what makes (2) possible: a promoted layer whose
children are rewritten every frame repaints regardless.

### Prior art — this is not a new conclusion here

The repo reached the same answer once before, for the SVG crease-pattern era.
`theme.css` still carries it:

> Promote the panned crease-pattern layer to its own compositor layer. Without
> this, panning re-rasterizes the entire (large) crease-pattern SVG every frame
> even though it's only being translated; with it, the pan is a cheap GPU
> composite of a cached raster.

…alongside the same trick for the grid layer. So the new rule lives in
`theme.css` beside those rather than as an inline style, where anyone auditing
what this app composites will find all of them together.

`useSettledScale` is the same idea along the other axis — hold the layout still
while the camera moves, let a transform carry the change, re-lay-out on settle —
for the window layers under zoom. It is a sibling, not a duplicate: scale has no
exact factoring, so it waits out a timer and bounds its stretch, where a
translation is exact and re-projects precisely when the basis changes. The two
hooks now point at each other.

Known trade: a promoted layer rasterises its text once and resamples it while
moving, so badge digits can soften mid-motion and snap crisp on settle. Judged
acceptable against the smoothness. The escape hatch, if it ever isn't, is
drawing badges in the renderer instead — see below.

## Affected Areas

- `apps/web/src/cp-workspace/camera/usePannedOverlayView.ts` (new)
- `apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.tsx`
- `apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.test.tsx`

## Checklist

- [x] `usePannedOverlayView` hook
- [x] `CpFoldAngleLayer` subscribes through it
- [x] Tests: pan translates the container and leaves badge nodes untouched; zoom
      re-projects and resets the offset; panning after a zoom measures from the
      re-planned view
- [x] Promote the badge layer
- [x] Confirmed smooth by hand on a production build
- [x] Lint, typecheck, web unit tests, production build

## Follow-ups, not in this change

- **Re-trace a pan** to confirm GPU-main busy has actually dropped, rather than
  trusting that it feels better.
- **Glyph atlas / badges in WebGL.** The renderer already enables
  `ANGLE_instanced_arrays`, and `wedgeProgram` / `pointProgram` already do
  instanced quads with model-space anchors and screen-space sizing — a text
  program is a sibling of those, not new territory. Roughly 600–800 lines
  including an atlas over 13 glyphs (`0-9`, `.`, `-`, `°`; monospace with
  `tabular-nums`, so one advance width), with the risk concentrated in
  device-pixel snapping for crispness, DPR changes, and theme tinting rather
  than in the graphics. Worth doing if the resampling softness proves annoying,
  or when `CpMeasureLayer` / read-only annotations want the same treatment.
  Note it does not generalise to *editable* text — Lexical needs real DOM.
- **Hit testing (88.8ms)** is untouched: the 300 nodes still exist and Blink
  still traverses them for the wheel target. Only moving off DOM removes it.
- **`removeChild` (45.9ms)** should not occur under a pure pan at all. If a
  fresh trace still shows it, something in the subtree is remounting per frame
  and wants its own look.
- **Promote only during motion.** A permanent `will-change` keeps a
  viewport-sized composited layer alive whenever badges are shown. Adding it on
  the first pan frame and dropping it on settle would reclaim that, at the cost
  of another timer.
- **`Folded3dWindowLayer` and `InlineSimulationLayer` are half-done.** Both use
  `useSettledScale`, so a zoom no longer re-lays-them-out per frame — but both
  still subscribe with `useCpOverlayViews()` and so re-render on every *pan*
  frame. They measured cheap in this trace (3.1ms and less) because the window
  count is small, but they are the same shape of problem and
  `usePannedOverlayView` is the missing half.
- **Two probably-dead CSS rules.** `.cp-panel__viewport .react-transform-component`
  and `.cp-grid-layer` promote SVG-era layers that the WebGL migration replaced;
  neither class appears in any component now. Left alone here rather than
  widening this change.

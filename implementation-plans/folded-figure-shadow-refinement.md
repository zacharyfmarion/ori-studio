# Folded Figure Shadow Refinement

## Goal

Make the folded-figure Shadow toggle produce a drop shadow that reads as depth —
uniform width, soft fade — and remove the Color alpha control from the folded
model menu, since transparency is not a supported product surface right now.

Two independent defects make today's shadows look janky:

1. **Width varies ~5× across a single figure.** Oriedita's Java2D drawer
   computes the shadow's offset length from `getBegin(lineId)` — the *1-based
   point id* — used as an x-coordinate (`FoldedFigure_Worker_Drawer.java:229`).
   The port reproduces this faithfully
   (`crates/oristudio-cp/src/folding.rs`, `push_paper_shadow_primitives`), so the
   band width comes out as `10 · edgeLength / garbage` instead of a constant 10.
   Measured on the kabuto fixture: 20 bands, widths 0.550–2.795 (5.1×), width
   tracking edge length at a near-constant ratio (~0.036). A drop shadow whose
   thickness scales with the edge it falls from does not read as a light source.

2. **No fade.** The kernel emits the shadow as a `Gradient` paint (20% black →
   transparent) exactly like upstream, but the web scene adapter collapses every
   gradient to its start colour
   (`apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts`), so each band paints
   as a flat 20%-black slab with a hard outer edge.

3. **Edges shadowed on both sides.** Found while fixing (1). Upstream decides
   which side of an edge the paper is on by sampling `Polygon::inside` at
   `midpoint + ε · offset` and accepting anything that is not `Outside`. That
   sample sits *within* `inside`'s own `Border` tolerance
   (`Epsilon::UNKNOWN_001`, 1e-4), so it frequently reports `Border` in both
   directions and the edge gets a band each way — 6 of 14 edges on kabuto.
   Correcting the width makes it worse, not better: the sample distance scales
   with the band, so it lands even closer to the tolerance boundary.

## Approach

### 1. Uniform shadow width (kernel, deliberate divergence)

Add `FoldedShadowGeometry { OrieditaExact, Refined }` to
`FoldedFigureRenderOptions`, defaulting to `Refined`. `Refined` uses the true
segment length for the perpendicular offset, so every band is a constant width
in object space, and samples the side test a fixed distance along the *unit*
normal — two orders of magnitude clear of the `Border` tolerance — requiring a
strict `Inside`, which is one band per shadowed edge. `OrieditaExact` keeps both
pieces of the upstream arithmetic verbatim.

The three `folded_figure_*_render_snapshot_from_segments` helpers exist solely
to feed `oriedita_render_oracle.rs`; they pass `OrieditaExact` so the byte-for-
byte parity gate against Oriedita stays green and unchanged. The product path
(`Session::folded_figure_render_snapshot` → `render_snapshot_impl`) gets
`Refined`.

Record the divergence in `PORTING.md` under the existing Oriedita
"Deliberate divergences" list.

### 2. Real gradient fade (web renderer)

Evaluate gradient paint **per vertex** in `cpFoldedToScene.ts` rather than
collapsing to `from_color`. The fill program already carries per-vertex RGBA and
interpolates across the triangle, so this needs no shader change.

This is exact for shadow quads, not merely an approximation: the quad is spanned
by the edge direction and the offset, the gradient axis *is* the offset, so all
four corners land at t=0 or t=1 with no clamping in the interior — and a linear
gradient is a linear function of position, which is what barycentric
interpolation reproduces. For any other (hypothetical) gradient primitive it
degrades to a per-vertex approximation, still strictly better than a flat fill.

### 3. Hide Color alpha (web UI)

Remove the Color alpha toggle from the folded model menu in
`CreasePatternPanel.tsx`. The `transparency_color` model field stays — it is
part of the Oriedita file format and must keep round-tripping through save/load
— it simply loses its control surface.

## Affected Areas

- `crates/oristudio-cp/src/folding.rs` — shadow geometry option + offset maths
- `crates/oristudio-cp/tests/folding.rs` — width uniformity / divergence tests
- `crates/oristudio-cp/tests/oriedita_render_oracle.rs` — pin `OrieditaExact`
- `PORTING.md` — document the divergence
- `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` — gradient evaluation
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — drop the toggle
- i18n catalogs — remove the retired `colorAlpha` strings

## Checklist

- [x] Add `FoldedShadowGeometry` and thread it through the render options
- [x] Correct the offset maths under `Refined`; keep `OrieditaExact` verbatim
- [x] Point the oracle-facing helpers at `OrieditaExact`
- [x] Rust tests: uniform width under `Refined`, quirk preserved under `OrieditaExact`
- [x] Per-vertex gradient evaluation in the scene adapter
- [x] Web test covering the gradient fade
- [x] Remove the Color alpha toggle
- [x] Update `PORTING.md`
- [x] Run i18n extract/stamp/check
- [x] Rust + web validation
- [x] Draft PR against `main`

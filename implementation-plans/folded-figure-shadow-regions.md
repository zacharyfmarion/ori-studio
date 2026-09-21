# Folded Figure Shadow Regions

## Goal

Make the folded-figure **Shadow** toggle produce shadows that read as soft
contact shadows cast by an upper layer onto the layer beneath it — continuous
along an edge, rounded at corners, confined to the paper that actually receives
them — instead of the patchwork of gradient rectangles we draw today.

This is the follow-on to `folded-figure-shadow-refinement.md`, which fixed the
*arithmetic* of Oriedita's shadow (band width, double-sided bands, the missing
fade). What is left is the *model*: a shadow drawn as one rectangle per
subface-graph edge cannot look right no matter how the rectangle is painted.

## Why today's shadows look janky

The port is faithful to `FoldedFigure_Worker_Drawer.java`: for every line of the
subface graph whose two sides show different faces, with one face above the
other, it fills a `SHADOW_OFFSET`-wide rectangle on the lower side with a linear
gradient from 20 % black to transparent
(`crates/oristudio-cp/src/folding.rs`, `push_paper_shadow_primitives`). The web
adapter (`cpFoldedToScene.ts`) triangulates each rectangle with per-vertex colour,
which reproduces the gradient exactly. Every defect below is a property of the
rectangles, not of how they are painted. Each was reproduced from a real kernel
snapshot in a throwaway prototype (see *Evidence*).

1. **Nothing clips the band to the paper that receives it.** A rectangle is
   emitted with a fixed width regardless of how big the receiving subface is, and
   it is drawn after every face, so it runs past narrow receivers onto whatever is
   there: faces *above* the occluder, the other side of the figure, or the crease
   pattern behind it. Those are the grey blotches around flap tips and outside
   the silhouette.
2. **Band ends are square.** A band is cut perpendicular to its edge at the
   edge's endpoints. Where the receiving region continues past that endpoint
   (its boundary turns), a light notch is left between the band's end and the
   region's edge; where the region ends before the band does, the band pokes
   out. The V-shaped notches along diagonals in the screenshot are this.
3. **Adjacent bands overlap.** At an inside corner of the receiver two
   rectangles overlap and their alphas compound into a darker square; at an
   outside corner of the occluder there is a wedge neither band covers, so the
   shadow stops dead instead of wrapping round.
4. **Bands are per graph line, not per silhouette edge.** The subface graph
   splits every straight edge at every crossing, so one ledge is several
   collinear lines, each with its own rectangle. Along a run with the same
   receiver they tile invisibly; wherever the receiver changes at a crossing
   the band stops or switches sides with a square end (2), whatever direction
   the receiver's boundary takes there. On a complex figure that is at nearly
   every crossing, not just at flap tips.
5. **Linear ramp.** Even a correctly placed band fades linearly to a hard zero
   at exactly `SHADOW_OFFSET`, which the eye reads as a second edge.

Oriedita has the same model, and it looks acceptable there for one reason: its
point-id bug makes the bands 0.5–3 object units wide (measured on kabuto in
the refinement plan), not the intended 10, so every defect above is a few
pixels tall. The refinement restored the intended width and so magnified all
of them several-fold — the shadows became more correct and less pretty. None
of this is fixable by adjusting the rectangles.

## Approach

### The model

Treat the shadow as a property of the **receiving region**, not of the edge.

- A *region* is the set of subfaces that show the same visible face
  (`visible_subface_face`), i.e. the cells between drawn paper edges.
- Region `R` (visible face `f`) is *occluded by* region `S` (visible face `g`)
  when they share at least one subface-graph line and
  `hierarchy.get(g, f) == Above`. This is exactly the test upstream's
  `line_no_bangou_kara_kagenoaru_subFace_no_bangou_wo_motomeru` makes, so which
  edges cast onto which paper does not change; lines whose faces have no order
  relation still cast nothing.
- The shadow at a point `p ∈ R` is `strength · profile(d / width)` where `d` is
  the distance from `p` to the nearest point on the **outline** of any occluder
  of `R` (all boundary edges of `S`, not only the ones shared with `R`, so that a
  flap edge crossing `R`'s boundary keeps its full width right up to that
  boundary instead of rounding off).
- It is evaluated only inside `R`'s own subfaces, which is what clips it.

This gives every property the rectangles lack: uniform along an edge however it
is split, rounded at convex corners, a clean mitre at concave ones (the
distance field is single-valued, so nothing compounds), cut by the receiver's
boundary and never painted on the occluder or the background. It is also what a
soft drop shadow of the upper layer *is*, restricted to a receiver.

Deliberately **not** proposed: rasterising and blurring occluder silhouettes
per receiver. It looks nearly identical, costs a render-to-texture pass per
region, and under-shadows narrow flaps (a thin strip of paper flush on a layer
still casts a full-width contact shadow, which the distance field gets right).

### Kernel: emit regions and occluder outlines

This is the only shadow implementation. `FoldedShadowGeometry` and both of
its variants go: `Refined` because this replaces it, `OrieditaExact` because
the only thing it served was a byte-for-byte oracle diff of the rectangles
themselves, and a parity gate for drawing code the product never runs is
exactly the kind of second implementation that confuses the next reader. The
render oracle keeps diffing the paper passes with shadows off, which is where
the fills and edges are covered anyway, and `parse_oriedita_render_primitives`
still reads upstream's gradient paints so the oracle's own output stays
parseable. The Java oracle's `*-shadows` commands are left in place: they
emit *upstream's* behaviour for inspection, which is the oracle's job.

`push_paper_shadow_primitives` emits one primitive per receiving region
instead of one per line:

```text
FoldedFigureRenderPrimitive {
  kind: FillPath,
  geometry: Path { one closed subpath per member subface, in tv space },
  style.paint: LayerShadow {
    sheet_thickness: f64,        // one sheet of paper, carried through the camera scale
    strength: f64,               // darkness at the contact line
    occluder_edges: Vec<FoldedFigureRenderEdge>,   // { from, to, step }, tv space
  },
}
```

`step` is how many sheets tall the ledge along that segment is: the faces
stacked in the cell on the casting side beyond those in the cell across the
line (`SubFace::face_ids.len()` on each side), never below one. A flap's own
edge is `1`; the side of an eight-layer stack is `8`. A line two casting faces
of one region share is counted from whichever side is taller.

`shadow_regions` builds it from what the pass already has:

1. `visible_subface_face` for every subface → region id per subface.
2. For every line with `line_face_border(line) == (a, b)`, both sides non-empty,
   visible faces `fa ≠ fb`: `viewer_order` names the nearer face from
   `hierarchy.get(fa, fb)`, swapped for the rear pass, and the farther one
   gains it as an occluder. Lines where `get` is `None` add nothing — that is
   upstream's rule, kept.
3. Outline of region `S` = every line with `S` on exactly one side, each with
   its ledge height from the two cells' layer counts.
4. Emit, for each region `R` with a non-empty occluder set, its member subfaces
   as subpaths and the union of its occluders' outlines as `occluder_edges`.

Emitting member subfaces rather than a merged outline is what keeps this
cheap: no polygon union, no holes, and the adapter triangulates each subpath
exactly as it does a face today. The primitive is pushed where the bands are
pushed now — after the pass's fills, before its edges — so the existing
`sequence` → depth ordering places it with no renderer changes.

Segments rather than polylines because the renderer only ever needs a segment
list, and because the SVG export strokes a segment list just as well.

### Web adapter: per-subface edge lists

`cpFoldedToScene.ts` learns the paint and forgets gradients — the per-vertex
gradient evaluation existed only for the old bands, and nothing the kernel
emits is a gradient any more. A `layer_shadow` primitive builds a new
`FoldedGeometry.shadows` channel, cached in `FoldedFigureLocalGeometry` like
the fills and transformed by the placement affine per frame:

- Each subpath is earcut-triangulated. Its vertices carry `depth`, the region's
  `strength`, `width · placement.scale`, and `(edgeBase, edgeCount)` into a
  shared edge table.
- The edge table is **pruned per subpath**: keep only occluder edges whose
  bounding box comes within `1.25 ·` their own reach of the subpath's; a
  subpath that keeps none emits no triangles at all. Subfaces are small, so
  the lists are short (a handful of edges) and most of a big region's area
  costs nothing. Capped at `MAX_SHADOW_EDGES` (24); over the cap keep the
  nearest by centroid distance.
- Edges are transformed by the same affine as the vertices, so a dragged,
  scaled or rotated figure keeps its shadow attached, and the width scales
  with the figure as a physical shadow would.

### Renderer: one new regl program

`programs/shadowProgram.ts`, shaped like `fillProgram.ts` (same view basis,
depth-ordered, premultiplied blend). The vertex shader forwards the user-space
position and the per-vertex shadow attributes; the fragment shader walks the
edge list:

```glsl
// WebGL1: constant loop bound, early break. Edges live in an RGBA8 texture,
// three texels per edge (two endpoints at 16-bit fixed point over the scene's
// edge bounds, then the ledge height) — no OES_texture_float dependency.
float a = 0.0;
for (int i = 0; i < MAX_SHADOW_EDGES; i++) {
  if (float(i) >= vEdgeCount) break;
  vec4 e = fetchEdge(vEdgeBase + float(i));   // x0 y0 x1 y1, user space
  float h = ledgeHeight(fetchStep(vEdgeBase + float(i)), vSheet);
  float boost = ledgeBoost(h * pxPerUnit);         // the pixel floor
  float d = segmentDistance(vUser, e.xy, e.zw);
  a = max(a, vStrength / boost * profile(d, h * boost));
}
gl_FragColor = vec4(0.0, 0.0, 0.0, a);        // premultiplied black
```

Each ledge casts its own shadow and the fragment keeps the darkest, so a tall
ledge further away can win over a low one nearby; for ledges of one height it
is the nearest edge, as a single distance field would be.

Drawn between `foldedFills` and `foldedStrokes` in `reglRenderer.ts`. The
`ANGLE_instanced_arrays`-only capability contract in `webglSupport.ts` is
unchanged. Per-frame cost is the edge texture re-upload (8 bytes per edge)
plus a few texel fetches per shadowed fragment.

### The curve: a contact shadow, not a band

The first version drew a band of half-width `0.4·reach` blurred by
`σ = 0.3·reach`, peaking at 20 %, ten units wide — a soft gradient with no
edge, which is a stylisation, not a shadow. What a step of paper actually
casts under diffuse light is ambient occlusion by a wall of height `h`: for a
long ledge under a uniform sky the light lost at distance `d` from the
contact line is

```text
f(d) = (1/2π) ∫ cos²φ / (cos²φ + (d/h)²) dφ      (φ over a half turn)
```

— one half at the contact, about half of that by `d ≈ 0.55 h`, and a
`h²/4d²` tail. Dark, narrow, sharp-edged, and as wide as the ledge is tall:
the thin dark line at the foot of every layer in a photograph.

`foldedShadowProfile.ts` draws that curve as the weighted sum of three
Gaussian-blurred bands (half-widths 0.2/0.6/1.5 h, σ 0.15/0.4/1.2 h; fitted to
within a few percent out to 2 h, and unit-tested against the integral), because
a blurred band is what both renderers can produce exactly:

- The shader evaluates each band analytically — a box convolved with a
  Gaussian is `½·[erf((a−d)/σ√2) + erf((a+d)/σ√2)]`, with the Abramowitz–Stegun
  erf approximation — from the distance to each casting segment, at that
  segment's ledge height, and keeps the darkest.
- `foldedFigureSvg.ts` draws the same thing literally: a `<clipPath>` of the
  receiving subpaths around one `<path>` per ledge height of the occluder
  edges, stroked with round caps at the innermost band's width, under a
  filter that dilates and blurs the stroke's alpha once per band, sums the
  bands with their weights (`feComposite operator="arithmetic"` — stacking
  would multiply them) and inks the sum black at the contact darkness. PNG
  export goes through `svgToPng`, so both files agree with each other; along
  straight edges they match the canvas exactly, at corners a 2D blur is
  marginally lighter on convex and darker on concave corners than the
  distance field. The `<linearGradient>` writer went with the gradients.

Ledge height `h = sheet_thickness · min(step, 12)`. Two deliberate departures
from the physics: the kernel's sheet is one object unit — a few times real
kami on a hand-sized sheet, since at true scale a one-sheet shadow is
invisible — and a ledge whose innermost band would be under 1.5 px wide is
widened to that and lightened by the same factor (`shadowLedgeBoost`), so a
flap edge draws as a crisp faint line at any zoom instead of flickering
between pixel centres. Contact darkness is 0.35: half the light is the
uniform-sky answer, and paper and the room reflect some back. The export's
pixel floor uses page units as pixels, which they are at the export raster
size.

### What stays exactly the same

- The render-oracle parity gate for every pass with shadows off.
- Which edges cast onto which paper (the hierarchy test), the `display_shadows`
  model flag, its persistence, the Style menu, and the `foldedFigureStyled`
  event — no new instrumentation is needed.
- 3D figures, which do not support the toggle today and still will not.

`PORTING.md` gets a line under the Oriedita divergences, next to the one the
refinement plan added.

### Follow-ups this enables (not in scope)

- **Thickness alone deciding what casts.** Today which edges cast is still
  upstream's rule — the two visible faces must be related in the layer order —
  so two flaps side by side of different thickness cast nothing on each other
  even though there is a step between them. The layer counts that size the
  shadow could also decide it; kept separate because it changes which edges
  cast at all.
- **Figure-on-page drop shadow.** The same primitive expresses it: receiver =
  the figure's bounds grown by `width`, occluder edges = the outer boundary
  lines, emitted *before* the fills with a small light-direction offset. It
  makes a figure read as an object sitting on the crease pattern. Worth a
  product decision on whether it is part of *Shadow* or its own toggle.

## Affected Areas

- `crates/oristudio-cp/src/folding.rs` — `shadow_regions`, the `LayerShadow`
  paint, the band code and `FoldedShadowGeometry` removed
- `crates/oristudio-cp/tests/folding.rs` — snapshot-level shadow tests on the
  kabuto fixture (the region relation itself is unit-tested in `folding.rs`)
- `crates/oristudio-cp/tests/oriedita_render_oracle.rs` — the `*-shadows`
  cases removed
- `PORTING.md` — record the divergence
- `apps/web/src/engine/oristudioCpTypes.ts` — the paint variant
- `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` — shadow channel,
  pruning, placement transform; gradient evaluation removed
- `apps/web/src/cp-workspace/renderer/types.ts` — `FoldedGeometry.shadows`
- `apps/web/src/cp-workspace/renderer/programs/shadowProgram.ts` — new
- `apps/web/src/cp-workspace/renderer/reglRenderer.ts` — draw order
- `apps/web/src/cp-workspace/folded/foldedShadowProfile.ts` — new
- `apps/web/src/lib/foldedFigureSvg.ts` — export twin; gradient defs removed
- wasm bridge rebuilt (`build:oristudio-cp-wasm`) — no bridge code changes

## Checklist

- [x] Kernel: region ids, occluder relation, outlines; emit `LayerShadow`
      primitives after the pass's fills
- [x] Kernel unit tests (kabuto, both passes): regions are the subfaces of one
      face, each subface in one region; every occluder is nearer the viewer
      than its receiver; occluders and outline lines come from the lines, all
      of them and nothing else; `viewer_order` on a two-face table
- [x] Kernel snapshot tests: off by default; receivers are the pass's own
      subfaces, each once; casting edges are drawn paper edges and touch the
      receiver; reach and darkness are upstream's constants; the shadow sits
      between the fills and the edges
- [x] Remove `FoldedShadowGeometry`, both variants, the band emitter and the
      oracle's `*-shadows` cases
- [x] `PORTING.md` divergence note
- [x] Web types + adapter: shadow channel with per-subpath pruning, cached
      local form, placement transform, figure opacity; tests
- [x] `foldedShadowProfile.ts`: erf profile, GLSL source, SVG parameters;
      tested against a numeric convolution of the band
- [x] `shadowProgram.ts` (RGBA8 16-bit edge texture, packing round-trip
      tested) + draw order pinned in the layer-order test
- [x] `foldedFigureSvg.ts`: clip + blurred stroke; tests
- [x] Ledge height on every casting edge (kernel, tested against the cells'
      layer counts on kabuto)
- [x] Occlusion curve: three-band fit of the wall integral, tested against
      it; pixel floor; SVG filter chain that sums the bands; seen on kabuto
      and the crane
- [x] Rebuild the CP wasm bridge before looking at anything in the browser
- [x] Validation: `cargo test -p oristudio-cp` (40 binaries green), clippy,
      fmt, `lint:web`, typecheck, `test:web` (7109 passing; the one failing
      file is the untracked precrease wasm missing from this worktree)
- [x] Agent browser pass: crane front and back, zoomed on the inside corner,
      scaled and rotated placement, SVG export rendered
- [ ] Browser pass (Zach): a real multi-layer model with Shadow on, front and
      back, zoomed in on flap tips, inside corners and the silhouette; drag,
      scale and rotate the figure; SVG and PNG export of the same figure

## Evidence

A throwaway Canvas2D prototype rendered the same kernel snapshot (a folded
crane, front pass, `display_shadows: true`) two ways: the current bands drawn
literally, and the region model above with topology read back off the bands.
Side by side, the region version has no spill outside the silhouette, no
notches or doubled corners, and continuous bands along split edges. Its
sliders (width, strength, profile) are what the defaults above were picked on.
The prototype is reference only; nothing from it is meant to be copied.

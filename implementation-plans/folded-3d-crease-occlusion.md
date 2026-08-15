# Folded 3D — creases need layer identity

> Follows `3d-folded-state.md`, which built the window this fixes. The bug is in
> the crease pass of both renderers, not in the ordering solver.

## Goal

Stop a 3D folded figure drawing the creases of buried layers. A flap lying flat
against the inside of a face currently has its whole outline traced on the
*outside* of that face, which reads as the layer order being wrong when it is
not.

The fix is not a constant to retune. It is that a crease in the mesh **carries no
layer identity**, so no depth-buffer setting can distinguish "this crease belongs
to the layer you can see" from "this crease belongs to the layer six plies down".
This plan gives creases the same per-`(cell, slot)` identity the faces already
have, which is what lets the z-buffer answer the question it is being asked.

## Current state

### The mechanism

`folded3dMesh.ts` spreads each cell's faces into a ply: slot *s* of an *n*-deep
stack is displaced along the plane's `up` by `((n − 1) / 2 − s) · eps`
(`folded3dMesh.ts:390`). Creases are deliberately **not** displaced
(`folded3dMesh.ts:456`) — they are emitted once, at the true fold line, which is
the *middle* of every stack they run through.

That leaves every crease behind the near half of its own stack, including the
layer it belongs to. To stop a visible layer's creases being swallowed by their
own face, the edge shader pulls every crease toward the viewer by a constant
`−0.0008` of NDC z (`meshRenderer.ts:462`). With `depthRange = 2r` that is
`1.6e-3 · r` of world depth — and `STACK_SPAN_LIMIT` caps the *entire* ply at
`8e-4 · r`, **half the bias, on purpose** (`folded3dMesh.ts:110`).

So the bias is guaranteed to exceed the whole stack. Every buried layer's
creases are lifted in front of every layer of that stack, and in front of
anything else within `1.6e-3 · r`.

### Measured

Crease centrelines sampled against a CPU mirror of the GPU depth buffer
(`projectVertices` is the maintained mirror of the vertex shader, so this is the
same arithmetic the GPU runs), at each figure's own camera:

| model | stack | layer gap | ply span | bias | bias ÷ span | ink on paper | bias-only | |
|---|---|---|---|---|---|---|---|---|
| `540-level-0` (reported) | 7 | 0.0218 | 0.131 | 0.261 | **2.0×** | 10125 | 4372 | **43%** |
| `box_90` | 5 | 0.0461 | 0.184 | 0.369 | 2.0× | 2347 | 789 | 34% |
| `spikes_small` | 4 | 0.0352 | 0.106 | 0.282 | 2.7× | 3399 | 1173 | 35% |
| `pinwheel` | 3 | 0.0141 | 0.028 | 0.113 | 4.0× | 820 | 394 | 48% |
| `strip_coupled` | 3 | 0.0187 | 0.037 | 0.150 | 4.0× | 1098 | 332 | 30% |

Every bias-only depth gap falls inside the bias window (max 0.2609 against a
bias of 0.2613 on `540-level-0`), so the bias is the whole cause rather than a
rounding effect. **Shallow stacks are worse**, because `EPS_RELATIVE` binds there
instead of the span cap and the ratio rises to 4×.

### Why the constant cannot just be shrunk

At bias 0, crease ink landing on its *own* visible paper drops from 1226 samples
to 601 on `540-level-0` — half the legitimate linework disappears, exactly as
`folded3dMesh.ts:96` predicts. There is no constant that both keeps the visible
layer's creases and hides the buried ones, because the crease is at mid-ply and
the visible layer is at the end of it.

### The export path has the same disease

`strokeIsBuried` (`foldedFigure3dProjection.ts:762`) asks only "is either
incident face the shown layer of *any* cell", which its own doc calls
deliberately conservative. It is the right idea evaluated at the wrong
granularity: a face buried here and shown there keeps its creases everywhere. So
SVG/PNG/`.osf` exports show fewer buried creases than the window, not none, and
the two renderers disagree.

## Approach

**A crease is drawn per `(cell, stack slot)`, from the cell's own ring, at that
slot's displacement.**

The cell ring is already the right geometry. Every segment fed to the arrangement
in `cells.rs` is a projected *face ring edge*, so every cell-ring segment lies on
some face's boundary — there are no synthetic cuts. And `Folded3dMeshSlots`
already emits each slot its own copy of the cell ring
(`vertexStart[i]..vertexStart[i+1]`). So the crease linework of a folded figure
is exactly:

> the cell-ring segments that bound real paper edges, taken per layer

and it needs **zero new vertices** — only an index buffer over vertices the slot
already owns. Vertex count goes *down* by `2 · edge_count`.

### The ink rule

For cell `C`, slot `s` holding face `f`, ring segment `p→q`:

> ink it iff some model edge `e` with `edge_attr[e].face_a == f` or
> `face_b == f` contains both `p` and `q`.

Un-inked means the paper of face `f` continues across that segment — the segment
is an arrangement cut introduced by a *different* face lying over it, which is
precisely the case that must not be drawn at this layer. The matched `e` also
carries the assignment and fold angle, so colouring is unchanged.

Everything that rule needs is already in the payload (`edge_attr`, `edge_points`,
`cell_points`, `cell_stack`). **No kernel change, no schema bump, no fixture
regeneration.**

This is the same per-cell question `strokeIsBuried` asks globally, so the
projector's version collapses into it and both renderers end up reading one
implementation — which is what `folded3dModelReader.ts` exists for ("the numbers
they read must be *the same numbers*, not the same formula written twice").

### The bias becomes a layer-relative nudge

Once a crease sits at its own slot it is exactly coplanar with its own face and
z-fights. It needs a nudge toward the viewer that beats coplanarity and **cannot
reach the next layer**: a quarter of the layer gap.

`0.25 · eps / depthRange` is camera-independent, because `depthRange = 2 · radius`
and `eps = min(EPS_RELATIVE, STACK_SPAN_LIMIT / (n − 1)) · radius`. It reduces to
a pure number — `2.5e-5` NDC for shallow stacks, `7.7e-6` at the corpus's deepest
(`plant_penguin`, 14). Both are resolvable in a 24-bit depth buffer (210 and 64
units); neither is in a 16-bit one, which is what the existing
`shallowDepthBuffer` warning is already for.

The shader constant becomes a uniform with today's value as the default, so the
inline simulator — whose layers are never coincident — is untouched.

### Rejected

- **Shrink the bias.** Measured above: costs half the legitimate creases.
- **Displace each crease to the outermost slot its faces occupy.** One
  displacement per crease cannot be right in every cell it crosses, and a crease
  is routinely top in one cell and buried in the next. Draws buried creases.
- **Port `strokeIsBuried` to the GPU.** Same documented conservatism; misses the
  common case, which is the one being reported.
- **Emit the provenance from the kernel** (a `cell_stack_ring_edges` array).
  Exact and it is where the information originates — but `cells.rs` throws the
  face/slot away when it builds `LineSegment`s for `FoldGraph::from_segments`, so
  it would mean threading provenance through Oriedita-derived code, plus a schema
  bump and a fixture regeneration. The frontend match is against coordinates the
  kernel emitted in one coordinate system, with the fallback below covering a
  miss. Escalate to this if the corpus shows matching is fragile.

### No silent loss

A model edge that matches nowhere would vanish from the drawing. Faces *can* be
dropped (`min_accepted_area_relative`), and cells with a ring under 3 points are
skipped, so this is reachable. Any model edge inked in no `(cell, slot)` falls
back to today's behaviour — emitted undisplaced, at the old bias — so a match
failure degrades to the current picture rather than to a missing line, and the
count is asserted in tests.

## Affected Areas

| File | Change |
|---|---|
| `apps/web/src/cp-workspace/folded/folded3dModelReader.ts` | New `buildFolded3dInk(model)` — the ink rule, built once per model, read by both renderers. |
| `apps/web/src/cp-workspace/folded/folded3dMesh.ts` | Creases from slot ring vertices; drop the trailing crease vertex block; `slots.edgeStart`; `undeterminedEdgeStart`; fallback edges. Header comment and `STACK_SPAN_LIMIT` doc are now wrong and must be rewritten. |
| ⤷ `folded3dMeshExtent` | Same pass, same numbers — it feeds `canWindowFolded3dFigure`, so it moves with the builder or the budget check lies. |
| `packages/origami-simulator/src/webgl/meshRenderer.ts` | `−0.0008` becomes `u_creaseDepthBias`; `MeshDrawOptions.edgeRange`. |
| ⤷ `RenderSettings` | Optional `creaseDepthBias`, defaulting to today's constant. |
| `apps/web/src/cp-workspace/folded/folded3dWindow.ts` | `folded3dWindowRenderSettings` sets the bias from the mesh. |
| `apps/web/src/simulator/foldedMeshSource.ts` | `folded3dDrawPasses` gains an edge range so undetermined cells' creases ride with their own pass. |
| `apps/web/src/components/start/startFigureMesh.ts` | Same two-pass shape; keep in step. |
| `apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts` | Stroke BSP items become per-`(cell, slot, segment)`; **delete** `visibleFaces` and `strokeIsBuried`. Golden primitive streams change — that is the point. |

Not touched: the kernel, the `.osf` schema, the ordering solver, the flat figure,
the inline simulator's own rendering.

## Checklist

### Phase 1 — the ink rule

- [x] `buildFolded3dInk(model)` in `folded3dModelReader.ts`: per `(cell, slot,
      ring segment)`, the model edge id or `-1`. Face→incident-edge index built
      once; containment tolerance derived from `span`, not a bare constant.
- [x] Unit tests on `pinwheel` (one plane, stacks to 3) and `box_90` (four
      planes, real coplanar overlap): named segments inked at the shown slot and
      not at buried ones.
- [x] Assert over all six fixtures that every model edge is inked somewhere, and
      report the exceptions rather than swallowing them.
- [x] Tolerance measured rather than guessed: a real match is at most 7.6e-11 of
      span and the nearest non-match is 8.8e-3, eight orders away, so the shipped
      1e-7 sits in the middle of a plateau three orders wide either side. Held
      open by `inkIsNotSensitiveToTheTolerance`.

### Phase 2 — the mesh (lands with Phase 3; alone it changes nothing)

- [x] Emit crease indices from each slot's existing ring vertices; delete the
      trailing crease vertex block.
- [x] `slots.edgeStart` (count + 1), mirroring `indexStart` / `vertexStart`.
- [x] `undeterminedEdgeStart`, so the undetermined pass owns its own creases.
- [x] Fallback: model edges inked nowhere emit undisplaced, as today.
- [x] `folded3dMeshExtent` updated in the same commit. It is now an explicit
      **upper bound** rather than exact — creases cost no vertices, so the slack
      is the un-inked remainder of `2 · edge_count`, and asking exactly would
      mean building the ink in what is meant to be an integer pass. Bounding is
      the safe direction for a budget check.
- [x] Rewrite the module header — it currently *argues for* the bug — and
      `STACK_SPAN_LIMIT`'s justification.
- [x] Rewrite the three mesh tests that encoded the old contract, rather than
      relaxing them: "one crease per model edge" becomes "a crease is a segment
      of its edge, on its layer"; "endpoints are exact" becomes "within the ply,
      and the displacement is really applied". Two new ones state the mechanism
      directly — a crease's ends are ring vertices of the slot that owns it, and
      a layer inks fewer segments than its ring has wherever another face cut
      the arrangement over it.

### Phase 3 — the bias

- [x] `u_creaseDepthBias` uniform; `RenderSettings.creaseDepthBias` optional,
      default `DEFAULT_CREASE_DEPTH_BIAS` = `0.0008`, so the inline simulator is
      untouched.
- [x] `folded3dCreaseDepthBias(mesh) = 0.25 · eps / (2 · radius)`, wired through
      `folded3dWindowRenderSettings` and the start-screen figure.
- [x] `MeshDrawOptions.edgeRange` + `folded3dDrawPasses` split. `buildEdgeQuads`
      now also returns a per-source-edge vertex offset, because facet edges are
      skipped and a caller assuming `6 · index` would draw the wrong creases.
- [x] Measured, over six fixtures x three cameras plus the reported model: the
      worst depth a drawn crease sits behind the surface covering it is **0.25
      layer gaps**, against 12 before, and bias-only ink on `540-level-0` falls
      from 43% to 1.3% — the remainder being the coplanar tie-break the bias
      exists for.

### Phase 4 — the test that would have caught this

- [x] A CPU depth-buffer harness, `folded3dCreaseOcclusion.test.ts`: rasterize
      the face pass from `projectVertices`, sample every crease centreline.
- [x] **The property: a crease is never drawn more than half a layer gap behind
      the paper covering it.** Stated in *layers* rather than in world units,
      because a depth in units means nothing without the sheet spacing to
      compare it against. Shipped configuration measures 0.25; the one it
      replaces measures 12.
- [x] Both invariants from the plan collapse into that one. "The bias must not
      change what is drawn" turned out to be the wrong statement — the bias
      legitimately settles the coplanar tie between a crease and its own face,
      so a small difference is the point rather than a defect. What must never
      happen is the difference reaching the *next sheet*, which is what the
      layer-relative bound says.
- [x] Over all six fixtures × `{default, antipodal, oblique}` cameras. The
      antipodal one matters: the `up`-toward-eye flip is a known trap
      (`foldedFigure3dProjection.ts:687`).
- [x] Teeth: a test asserting the old constant fails the same bound on
      `spikes_small`, and reverting `folded3dCreaseDepthBias` to it turns all 25
      of these red.

### Phase 5 — the export path agrees

- [x] `buildItems` emits stroke items per `(cell, slot, inked segment)` carrying
      the owning `(cell, face)`, keeping `order = drawRank` so `sortCoplanar`
      still holds.
- [x] `expand` inks only the slot it already selected for the fill; `cellDrawOrder`
      is now the single answer both arms read. `visibleFaces` and
      `strokeIsBuried` are deleted.
- [x] A crease now reports its owning cell and face in `Folded3dProjection`,
      which it could not before — it belonged to no layer. That is what lets the
      hidden-crease rule be *asserted* instead of pinned to a magic count, and
      the buried-crease test now says "every drawn crease's face is the face its
      cell shows" at three cameras.
- [x] Golden primitive stream refreshed: same primitives, reordered and some
      reversed, because a crease is now a ring segment rather than a payload
      edge. Nothing added or removed on `hinge_90`.
- [x] Measured ink, not counts. Crease *length* drawn falls 24% on `pinwheel`,
      13% on `box_90`, 2% on `spikes_small`, and is unchanged on `hinge_90` and
      `strip_coupled` — the two with no partial overlap, exactly as in the mesh.
      The primitive count rises, because segments are shorter than the edges they
      came from; counting them says the opposite of what is happening.

### Phase 6 — optional, separate PR

- [ ] `STACK_SPAN_LIMIT = 8e-4` exists *only* because the crease bias was
      `1.6e-3` and the ply had to stay under half of it. That coupling is gone
      and the doc comment now says so. Re-derive the cap from depth-buffer
      resolution and sub-pixel displacement instead, which buys headroom for deep
      stacks (`plant_penguin` at 14). **Not done** — deliberately out of scope so
      this change is about creases and nothing else.

## Phase 7 — a buried layer's creases are not in the opaque draw

Found by `simple_outline_fixture.osf`: four faces, three of them coplanar, and
two creases drawn where one belongs.

Phases 1–5 put every crease at the depth of its own layer and then asked the
depth buffer to hide the buried ones. That cannot work, and the reason is
structural: **the ink rule puts every crease on a cell boundary, which is
exactly where the covering face's displacement is discontinuous.**

`offset = ((stack.length − 1) / 2 − slot) · eps` reads the *cell's* stack depth.
So one physical face sits at `+1 · eps` as the top of a 3-deep cell and at `0` as
the only layer of the cell next door — a full layer gap apart, across a seam that
a crease lies exactly along. Measured on the fixture: face 3's copy of the fold
at `z = −175` is drawn on 52 of 201 samples, and **all 52 sit over
`cell1/slot0/face2`** — the neighbour's copy of the covering face.

The fix does not need the depth buffer at all. A cell is covered by every face in
its stack, so a layer that is neither top nor bottom is behind the top from one
side and behind the bottom from the other, at every camera. Those creases are
emitted to a trailing block and left out of the opaque draw; a translucent style
shows the whole stack and takes them, which is what the projector already did.

- [x] Split crease emission into outer and interior; `interiorEdgeStart`.
- [x] `slots.edgeStart` → `mesh.creaseSlot`, a per-crease record, because the
      creases are no longer in slot order.
- [x] `folded3dDrawPasses` ends the opaque range at `interiorEdgeStart`.
- [x] The projector needed no change: `cellDrawOrder` already returns one slot
      for opaque paper and the whole stack for translucent, so it has been
      applying this rule since Phase 5. That is the parity working.
- [x] Verified on the fixture at its own camera: the crease that should show
      draws 193/201, the one that should not draws 0/201. One crease, as
      reported.

## Phase 8 — skins: stop asking the depth buffer about coplanar layers

Phases 2–7 all displaced coplanar layers by a hair and asked the depth buffer to
reconstruct an order the kernel had already computed. Each phase removed one
symptom and the next found another, which is the shape of a wrong mechanism
rather than an incomplete fix. The 2D path never had any of these problems,
because it sorts back-to-front and paints: occlusion there is discrete and
exact, decided by the order itself.

**A plane's visible surface is the top face of each of its cells.** The opposite
side's is the bottom face of each. Those two *skins* are facts about the model,
built once, and the eye picks one per plane by the sign of `up · eye`. That is
exact rather than approximate because a folded figure is drawn orthographically,
so every ray shares a direction and the sign is one bit for the whole plane.

Inside a skin there is one face per cell and cells are area-disjoint, so nothing
coplanar is ever drawn together. The depth buffer is left deciding plane against
plane — real geometry, genuinely separated.

- [x] `Folded3dSkin`, two per plane, built from `cell_stack`'s first and last
      entry. No topological sort, so a cyclic order works by construction.
- [x] `folded3dDrawPasses` takes the camera and emits one pass per run of planes
      that chose the same side, then the undetermined cells translucent.
- [x] **The layer displacement is deleted**, and with it `EPS_RELATIVE`,
      `STACK_SPAN_LIMIT`, `folded3dLayerEpsilon`, `RANK_NUDGE_FRACTION` and
      `mesh.eps`. The paper sits where the kernel put it.
- [x] The crease bias becomes `FOLDED_3D_CREASE_DEPTH_BIAS = 1e-5` of NDC z. It
      only has to break the tie between a crease and the one face it lies on, so
      it can be 80× smaller than the constant it replaces — and being small is
      the point: it can no longer lift a crease through paper genuinely in front
      of it.
- [x] Translucent styles keep the full stack, which is what they are for;
      coplanar layers are harmless there because translucent faces do not write
      depth.
- [x] The projector needed no change at all. It has drawn one layer per cell
      since Phase 5, which is what a skin is — the two paths now use the same
      rule, reached from two directions.
- [x] Verified on `simple_outline_fixture.osf` at its own camera on the real
      GPU: full-width ink rows at 108, 109, 159 and 385 — two borders and the one
      fold. Drawing every layer's creases instead adds a 260-pixel band at row
      209, which is the second line that should not be there.

## Phase 9 — a crease is drawn inside its own face

Found by `repro.osf`: the same strip twice, once with its rightmost crease flat
and once at 90°. The flat one is right; the 90° one shows that fold through the
paper covering it.

Phase 8 rested on "a crease is only ever coincident with the single face it lies
on". That is true of a flat fold and false of every other one. **A fold line lies
in both planes it joins** — that is what a fold is — so a crease left on the line
is exactly coplanar with whatever the *other* plane has along it, which may be
paper in front of the layer the crease belongs to. The crease bias, however
small, then tips it in front.

In the repro: the 90° fold joins a flap (its own plane) to the buried layer of a
wall. The line sits on the wall's surface, so from the side the flap is hidden
on, the crease is coplanar with the wall's visible face and draws over it.

The fix is geometric, not another epsilon: draw a crease a hair **inside its own
cell**, along the in-plane inward normal. It then carries the depth of the paper
it bounds instead of the depth of the fold line, and ordinary plane-against-plane
depth testing answers correctly — from every camera, in any draw order, with no
sorting.

- [x] `CREASE_INSET_RELATIVE = 1e-3` of radius: about a quarter of a device pixel
      on a 512-frame window, and 50× the crease bias in depth separation when the
      occluding plane is face-on. It shrinks with the angle between the planes
      and vanishes when the occluder is edge-on — which is exactly when the
      occluder covers no pixels to hide anything behind.
- [x] The inset ring is emitted per slot beside the paper ring, mitred at the
      corners from the mean of the two adjacent inward normals so it closes
      rather than leaving a gap at each turn. Handedness is read off the ring's
      own signed area, because the kernel promises no winding.
- [x] Measured on the reported file at its own camera: crease samples drawn over
      **another plane's** paper at equal depth fall from **177 to 0** on the 90°
      figure, and 12 to 0 on the flat one. What remains across the fixtures is
      under 2% of drawn samples, at plane-boundary pixels where which plane owns
      the pixel is a rasterisation tie rather than an occlusion fact.

## Validation

Web-only, so: `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`.
`npm run build:web` on the Phase 3 shader change. No Rust, so no `cargo` and no
oracle.

Phases 1–4 are fully self-verifiable — the depth-buffer harness answers the
picture question without a canvas, which is why it is the deliverable and not a
screenshot. Browser verification of the finished window is Zach's.

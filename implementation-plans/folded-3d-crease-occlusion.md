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

- [ ] `buildItems` emits stroke items per `(cell, slot, inked segment)` carrying
      the slot, keeping `order = drawRank` so `sortCoplanar` still holds.
- [ ] `expand` inks only the slot it already selected for the fill; delete
      `visibleFaces` and `strokeIsBuried`.
- [ ] Refresh the golden primitive streams and say in the PR which figures lost
      linework and why.
- [ ] Assert the window and the projector agree on the drawn crease set for each
      fixture, so the two cannot drift apart again.

### Phase 6 — optional, separate PR

- [ ] `STACK_SPAN_LIMIT = 8e-4` exists *only* because the crease bias was
      `1.6e-3` and the ply had to stay under half of it. That coupling is gone.
      Re-derive the cap from depth-buffer resolution and sub-pixel displacement
      instead, which buys headroom for deep stacks (`plant_penguin` at 14).

## Validation

Web-only, so: `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`.
`npm run build:web` on the Phase 3 shader change. No Rust, so no `cargo` and no
oracle.

Phases 1–4 are fully self-verifiable — the depth-buffer harness answers the
picture question without a canvas, which is why it is the deliverable and not a
screenshot. Browser verification of the finished window is Zach's.

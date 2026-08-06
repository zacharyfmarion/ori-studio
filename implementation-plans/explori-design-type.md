# ExplOri as a design type

## Goal

Add **ExplOri** — the 22.5° crease-pattern search engine at
`225.designorigami.net`, built on
[`theplantpsychologist/SEARCH-22.5`](https://github.com/theplantpsychologist/SEARCH-22.5)
— as a third design kind that opens in a Design tab, beside Circle-packed
(TreeMaker) and Box-pleated.

The tab is **tree on the left, results on the right**. Clicking a result opens a
detail view where it can be sent to the Edit canvas; each result card also
carries a one-click Send to Edit. Queries hit the upstream backend directly
rather than reimplementing the search.

Getting there requires one thing first, and it is the larger half of the work:
**the box-pleat tree editor has to become a component that any surface can
mount.** ExplOri is its second consumer; the TreeMaker design panel is the
obvious third. That extraction is Phase 0 and is planned in the most detail
here, because a seam drawn badly now is a seam three surfaces have to live with.

The extraction also carries a **change to how box-pleat trees are drawn**
(Phase 0.5): dragging a node sets its edge's length as well as its direction,
snapped to integers for box-pleat and continuous for ExplOri. That is what makes
the two editors one editor rather than two that resemble each other — and it
removes the add-then-go-edit-the-number step from box-pleat authoring.

## Context

### What ExplOri is

A precomputed database of 22.5° tilings, embedded spectrally. You draw a tree,
it embeds your tree the same way, and FAISS returns the nearest crease patterns.
There is no optimizer in the loop — this is lookup, not solve, which is why a
query answers in under a second and why the results are *real, foldable,
rational* CPs rather than something we would have to exactize.

Relationship to what we already ship: TreeMaker solves a tree into a circle
packing; Box-pleat packs a tree onto a grid; ExplOri *retrieves* a CP whose tree
is close to yours. Same input artifact — a tree — three different engines
behind it. That symmetry is exactly why the design-kind registry from #211 is
the right place to hang it, and why the tree editor is worth extracting.

### The backend contract (measured, not assumed)

Verified against production on 2026-08-06 with one probe query (5 nodes, 4
edges, `N=4 book`, `n=3`):

| | |
| --- | --- |
| `POST /api/query` | `{tree: {nodes: [{id,x,y}], edges: [{u,v,length}]}, db_configs: [{N,symmetry}], n}` |
| `GET /api/fetch_tiling?id=&N=&sym=` | the same bundle shape for one known tiling |
| `GET /api/result/<query_id>` | the server's in-memory cache of a previous bundle |
| Latency | **0.78 s** end to end |
| Response | **89 KB** for 3 results |

Where those 89 KB go, and what it means for us:

- `bundle_pickle_b64` — **41.8 KB, 47% of the response.** A base64 Python
  pickle of the whole result set. Useless to a JS client and a thing no client
  should ever deserialize. Strip it at our proxy; that alone halves the payload.
- `heat` — 3.7 KB *per result*: a 64-dim WKS signature for the query and the
  result. Only needed to draw a spectral comparison, and their own results grid
  has already stopped using it (`getMatchQuality` now thresholds raw distance;
  the norm-divided version survives only in `detail.js`). Drop it, and take the
  raw-distance thresholds as canonical.
- Per result, what is actually worth keeping is ~8.3 KB: `cp` (1.4 KB),
  `fold` (1.7 KB), `packing` (2.8 KB), `tree` (0.6 KB), `topology` (1.5 KB),
  plus `rank / distance / N / symmetry / topology_id / tiling_id`.

`refs` — the folding references for a CP — comes back **empty from
`/api/query`** and is populated only by `/api/fetch_tiling` (it is
`database/refs/query.lookup_vertices`, called from `tilings/inspect.py`). So
the detail view earns its own fetch: opening a result is where references
appear.

`cp` is the important payload and it is *exact*: vertices are rationals in
ℚ(√2) as `[x.num, x.den, y.num, y.den, z.num, z.den, w.num, w.den]`, mapped to
the plane by

```
cartesian = ( x + (√2/2)(y − w),  z + (√2/2)(y + w) )
```

Observed denominators are 1, 2, 4 — small powers of two. Every CP lands in the
**unit square [0,1]²**. Edge types are `'m'`, `'v'`, `'b'` (border), `'h'`
(their "unknown/flat hinge"), with `'aux'` reserved.

Their client-side validation, which ours should match: **≥ 4 edges** and a
connected graph, or the server 400s with "The drawn graph is disconnected".
Databases are `N ∈ {2,3,4,5}` × `symmetry ∈ {diag, book, none}`, with a
hardcoded quirk — selecting `5 book` implicitly also queries `6 book`.

### What we cannot do from a browser

**`OPTIONS /api/query` returns 501 and no response carries
`Access-Control-Allow-Origin`.** Verified directly:

```
$ curl -i -X OPTIONS https://225.designorigami.net/api/query -H 'Origin: https://oristudio.app' …
HTTP/2 501
Message: Unsupported method ('OPTIONS').
```

It is a stdlib `BaseHTTPRequestHandler` with no `do_OPTIONS` and no CORS
headers, behind Cloudflare. A JSON `POST` from our origin triggers a preflight,
the preflight 501s, and the request never happens. **The browser build cannot
call this backend directly, at all** — this is not a tuning problem, and no
amount of client-side care works around it.

That single fact decides the transport design in Phase 2.

### Working with upstream

**Permission granted** — theplantpsychologist has given the go-ahead to
implement (Discord: `https://discord.gg/5YcGh8b9yC`). Three things still follow
from the fact that this drives traffic to someone else's server:

- **Before merge, confirm they will not change the API without notice.**
  `/api/query` is unversioned, so the client validates response shape
  defensively regardless — but a silent break would take the feature down with
  no signal on our side.
- Their handler logs the query tree, the caller's IP, and the full request
  headers to a Google Sheet. **Users must be told their tree leaves the
  machine.** That is a feature notice, **not** analytics, so it must not be
  gated on the PostHog opt-out.
- Attribution belongs in the pane. `components/DesignAttributionFooter.tsx`
  already exists for exactly this and should carry ExplOri's credit and links.

#### What is worth asking them for

Ranked by what it actually buys us. Note that **CORS is not on this list** — an
earlier draft claimed a CORS fix would let us drop the proxy, which is wrong: we
want the proxy regardless, for trimming, caching, rate limiting, a stable error
surface, and a distinctive `User-Agent` (a browser cannot set that header; a
Worker can). Fixing CORS would remove a hop we have other reasons to keep.

1. **Drop `bundle_pickle_b64`, or gate it behind a request flag.** It is **47% of
   every response** and **their own client never reads it** — no reference to it
   anywhere in `interface/static/`. It also costs them CPU on the hot path:
   `_sanitize_for_pickle` recursively walks every result — graphs, CP objects,
   vertices — on every query, to produce bytes nobody consumes. Roughly:

   ```python
   def build_response_bundle(query_tree, results, db_configs, include_pickle=False):
       ...
       if include_pickle:
           bundle["bundle_pickle_b64"] = serialize_result_pickle(...)
   ```

   This is a win for them and their own users, not a favour to us.
2. **Notice before API changes.** Ideally a `schema_version` field in the
   response, so a break is detectable rather than mysterious.
3. **Etiquette:** what request rate is acceptable, and whether they want a
   distinctive `User-Agent` from our proxy so Ori Studio traffic is visible in
   their logs (they already log UA to the sheet).
4. **`refs` on `/api/query`**, or a flag for it. Today references come only from
   `/api/fetch_tiling`, so opening a result costs a second round trip. Low
   priority — caching by tiling id mostly covers it.

`heat` is a softer case: 3.7 KB per result, read in exactly one place
(`detail.js:86`) whose normalization the results grid has already abandoned
(`results.js:59`, commented out, now using raw distance). Worth mentioning, but
it is live code and their call.

## Approach

### Phase 0 — A tree editor any surface can mount

#### Why the current one cannot be reused as it stands

`components/panels/BpTreePanel.tsx` (923 lines) is a good editor and a bad
component. Everything it touches is box-pleat:

| It depends on | Which is |
| --- | --- |
| `OristudioBpTreeView` / `…TreeEdge` | the BP engine's snapshot type |
| `tree.sheet` everywhere (`bpTreePaperRect`, `bpTreePointToSvg`, `constrainBpTreePoint`, `bpTreeUnitToSvg`) | BP's paper; ExplOri has no paper |
| 8 store actions (`addOristudioBpTreeLeaf`, `moveOristudioBpTreeVerticesWithSymmetry`, `setOristudioBpTreeEdgeLength`, `renameOristudioBpVertex`, `selectOristudioBp`, `clearOristudioBpSelection`, `setOristudioBpActiveSurface`, …) | async round trips to the BP worker |
| `OristudioBpSelection`, `bpLinkedSelection` | BP's selection union and its tree↔packing linking |
| `useBpTreeSymmetry`, `symmetry.pairs` | BP document state |
| `useSettingsStore.bpTreeLayers` | a BP-named settings slice |
| `useBpLongPressInspector` | BP's inspector |
| `fitKey: ${document.handle}:${document.source.filename}` | a BP engine handle |

None of that is wrong; it is just all of it. The extraction is not "make it
generic" — it is **name the five things a tree editor actually needs and let
each host answer them**.

#### The seam

One interface, `TreeEditorHost`, supplied by the mounting surface. The component
renders, hit-tests, drags, and previews; the host owns the model, the geometry
frame, and every mutation.

```ts
// apps/web/src/tree-editor/host.ts
export interface TreeEditorHost {
  /** Committed model. New object identity on every change — the scene memoizes on it. */
  tree: EditableTree;
  /** Tree-space ↔ SVG-space, plus where a point is allowed to be. */
  frame: TreeFrame;
  /** What a length means here: bounds, step, quantization, formatting. */
  lengths: TreeLengthRule;
  /** Whether a dragged node brings its subtree. True for both kinds here. */
  carrySubtree: boolean;
  /** Extra "the gesture may not go here" predicates — BP passes its sheet. */
  dragBounds?: readonly TreeDragPredicate[];
  /** Camera-fit identity. Refit when this changes, never on an edit. */
  fitKey: string;

  selection: TreeSelection;
  select(next: TreeSelection): void;
  /** Extra marks to draw as selected — BP links a tree edge to its flap. Default: identity. */
  linkedSelection?(selection: TreeSelection): { vertices: Set<number>; edges: Set<number> };

  addLeaf(parentId: number, loc: Point): void | Promise<void>;
  moveVertices(updates: readonly TreeVertexUpdate[]): void | Promise<void>;
  setEdgeLength(edgeId: number, length: number, repositions: readonly TreeVertexUpdate[]):
    void | Promise<void>;
  renameVertex?(id: number, name: string): void | Promise<void>;

  /** Null means this surface has no mirror draw, and no mirror UI is rendered. */
  symmetry: TreeSymmetryHost | null;

  /** Host-specific side effects on focus / long press. Both optional. */
  onSurfaceFocused?(): void;
  onLongPress?(event: PointerEvent, target: TreeSelection): void;
}
```

Two rules make this work, and both are already true of the existing panel — the
extraction is preserving them, not inventing them:

1. **Intents are fire-and-forget, and the tree is the only source of truth.**
   The component never optimistically mutates. It calls an intent and waits for
   a new `tree`. BP's intents are worker round trips that land a frame or two
   later; ExplOri's are synchronous local updates. The component cannot tell the
   difference, and must not try to.
2. **A gesture in flight writes DOM, not state.** `lib/bpTreeSceneDom.ts` is the
   contract that makes a drag cost O(moved) instead of O(tree). It moves across
   as-is (renamed), and the memoized scene keeps its "committed state only" prop
   rule.

#### One drag rule, with the length rule as its only parameter

The two editors are the same editor. Box-pleat snaps lengths to integers;
ExplOri does not. Everything else is identical, and the drag rule is where that
identity has to be made real:

> **Dragging a node sets both the direction and the length of its edge to the
> parent.** The length is whatever the quantizer says the cursor distance is —
> `round` for box-pleat, identity for ExplOri — and the node's whole subtree
> comes along rigidly.

So if you drag a length-1 flap outward but stay nearer 1 than 2, the flap stays
1 and the subtree just rotates. Cross the midpoint and the length becomes 2, and
the subtree translates out with it. Today's behaviour is the special case where
the quantized length happens not to change.

The transform, given parent `P`, committed node position `A`, cursor `C`:

```
û  = unit(C − P)                          direction the cursor asks for
r  = clamp(quantize(|C − P|), min, max)   length the quantizer allows
Δθ = signedAngle(A − P → û)
Δr = r − |A − P|

X' = P + R(Δθ)·(X − P) + Δr·û             for every X in the subtree
```

`A` maps exactly to `P + r·û`, every edge *inside* the subtree keeps its length
(a rotation composed with a translation is an isometry, applied uniformly), and
exactly one edge changes: the one being dragged. With `Δr = 0` it reduces
literally to today's `rotatePointsBy`.

That leaves the length rule as the only thing hosts vary:

```ts
export interface TreeLengthRule {
  min: number;
  max(edge: EditableTreeEdge): number | null;
  /** null ⇒ continuous. A number ⇒ the +/− buttons and the field's `step`. */
  step: number | null;
  /** Cursor distance → an admissible length. `session` carries drag hysteresis. */
  quantize(distance: number, session?: QuantizeState): number;
  format(value: number): string;
}

export const SNAPPED_LENGTHS: TreeLengthRule = {     // box-pleat
  min: 1, max: (e) => e.maxLength ?? null, step: 1,
  quantize: snapToIntegerWithHysteresis, format: (v) => formatNumber(v, 2),
};
export const CONTINUOUS_LENGTHS: TreeLengthRule = {  // ExplOri
  min: 1e-3, max: () => null, step: null,
  quantize: (d) => d, format: (v) => formatNumber(v, 3),
};
```

Everything integer-flavoured in `BpTreeEdgeLengthEditor` — `step={1}`,
`min={1}`, `Math.max(1, value)`, `Math.round(edge.length) ± 1` — reads from this
instead. With `step: null` the ± buttons become a proportional nudge (×1.1 / ÷1.1
reads better than ±1 on a continuous length) and the field accepts any positive
float. The field does not go away: typing `1.37` is still how you get exactly
1.37, and typing `7` is faster than dragging seven units.

Two traps. BP's `maxLength` is *not* a design constraint — it is upstream's
`MAX_TREE_HEIGHT` overflow guard, deliberately clamped-but-never-shown
(`BpTreePanel.tsx:180`); keep it unshown, and `CONTINUOUS_LENGTHS` returning
`null` must read as "no max", not "max 0". And `quantize` is called per pointer
sample, so a bare `Math.round` makes the flap flicker between 1 and 2 whenever
the cursor sits near 1.5. It needs **hysteresis**: hold the current integer `n`
until the raw distance passes `n ± (0.5 + h)`, with `h ≈ 0.08` units, reset per
drag session. That state lives on the drag session, which is already mutable.

There is one further parameter, and only because a third consumer will want it:
`carrySubtree`. Box-pleat and ExplOri both want `true`. TreeMaker's tree drags a
node alone and lets *every* incident edge's length follow, so it maps onto the
same rule with `carrySubtree: false` — which is what keeps the interface honest
about the third surface without touching it in this plan.

#### What the new drag rule drags in with it

The user-visible change is one sentence long. The consequences are not, and this
is the part that needs care.

**The mirror clamp becomes two-dimensional.** `clampRotationToMirror` solves
analytically for where a *rotating* point meets the axis — a point on a circle,
one `acos`. Under the new rule a held point's path is a circle plus a
translation that itself depends on the angle, so the closed form goes away.
Generalize the way the existing code already chose to think about it: sweep the
gesture. Parameterize `t ∈ [0,1]` from `(0, 0)` to `(Δθ, Δr)`, and take the
largest `t` for which every held vertex is still clear of the axis. Coarse
step (~16) to find the first violating interval, then bisect (~10) inside it —
about 26 evaluations of a cheap predicate per held vertex per sample, which is
nothing, and it keeps the "slide until it hits the wall" feel. The valid set can
be disconnected, which is exactly why the analytic route is a trap.

**The same sweep should also own the sheet clamp — and doing so fixes a latent
bug.** `startBpTreeDrag` currently clamps *each rotated point* into the sheet
(`constrainBpTreePoint` per vertex), which means a subtree swung against the
sheet edge is silently distorted: its internal edge lengths change. Nobody
notices today because lengths are not shown live. Once the length readout is
live, they will. Clamping the *gesture* instead of the points makes rigidity
unbreakable by construction, and it is one more predicate on the same sweep.
ExplOri has no sheet, so it passes no such predicate.

**The tree sheet is load-bearing, so that clamp stays.** Where a leaf is drawn
is where its flap *starts on the paper*: `seedBpFlapAnchor` maps the tree point
proportionally into the layout sheet and moves the new flap there
(`oristudioBpSlice.ts:313`), which is a port of upstream's own
`getRelativePoint` (`tree/vertex.ts:177`, guarded by `$isNew` — the coupling
holds for the placement gesture and then the two sheets go their own way). For
anyone hand-packing rather than optimizing, that initial arrangement *is* the
starting layout: draw the head up top and the legs below and the flaps land
roughly there, ready to nudge.

Which makes unclamping specifically bad rather than merely untidy. The seed map
is proportional-then-clamped (`constrainBpPackingPoint`), so an off-sheet tree
node does not produce an invalid flap — it produces one **piled on the border
with every other off-sheet node**, all mapping to the same clamped cell. That is
a partial re-run of the bug `lib/bpFlapSeeding.ts` exists to fix ("every leaf
added lands its flap on the same cell"). Silently collapsing distinctions is
worse than refusing the drag.

**Quantization interacts with the clamps.** Sweep continuously, then quantize
the achieved `r`, then re-validate — and if quantizing pushed it back over a
wall, step down one admissible value. Do not quantize first and clamp after: the
committed length has to be an integer for BP, and a clamp applied afterwards
will not produce one.

**A paired flap's partner must change length too.** Mirror-draw pairs currently
commit position updates only (`buildMirroredBpTreeUpdates`), which was sufficient
while a drag could not change a length. Now a lengthened flap has to lengthen its
partner, so the drag commits *position updates plus up to two edge-length
changes* as **one undo entry**. `setOristudioBpTreeEdgeLength(vertices, length,
updates)` is the precedent — it already carries both — but it takes a single
length, so the BP slice needs to accept a list. And a pair whose two edges have
different `maxLength` must clamp to the tighter of the two, or the pair silently
desynchronizes.

**Click-to-add uses the same rule, which is the point.** Today a canvas click
adds a *unit* leaf and you then go edit the number — the thing this change is
meant to remove. It becomes `quantize(|click − parent|)`: click three units out,
get a flap of 3. `unitLeafLocation` becomes `leafLocationAt(parent, toward,
lengths)`, and the hover ghost previews the quantized position **and its length
as a number**, so you can see "3" before committing.

This also *improves* flap seeding, which is a nice second-order effect. Today a
click far up-right still lands the leaf one unit up-right, so the seeded flap
lands near the parent regardless of where you aimed — the click's distance is
discarded. Under the new rule the leaf goes where you clicked, so the flap seeds
where you clicked. For a hand-packer the click position finally means what it
looks like it means.

**The length label has to update mid-drag.** The scene draws edge labels as
static React output, and the drag writes DOM. `sceneDom` gains a "set this edge's
label text" write, or the whole feature is invisible while the gesture is
running. Related decision: labels are drawn for leaf edges only
(`layers.labels && edge.isLeafEdge`), so dragging a river shows nothing — the
dragged edge should show a transient label whatever its type.

**Small ones.** With the cursor nearly on the pivot, `û` is noise: hold the last
good direction rather than today's default-up (which is right for a click and
wrong for a drag). Dragging inward clamps at `min` and keeps rotating. The root
still has no parent and still does not move.

**And ExplOri's units are not free.** The query embeds the tree with `weight =
1/length`, so the Laplacian spectrum is **not scale-invariant** — absolute
lengths matter to which CPs come back. Their editor's `hypot/60` puts a typical
drawn tree in the 1–5 range, so our tree unit must be their tree unit. Verify
empirically: send one tree at two scales and check the results differ.

#### Module layout

A new top-level `apps/web/src/tree-editor/`, peer to `cp-workspace/`. Not
`lib/` — this is a surface with components, not a helper module — and not under
`components/panels/`, which is a composition site by the rule in AGENTS.md.

```
apps/web/src/tree-editor/
  model.ts              EditableTree, EditableTreeVertex/Edge, TreeSelection, TreeVertexUpdate
  host.ts               TreeEditorHost, TreeSymmetryHost
  frame.ts              TreeFrame; createPaperTreeFrame(sheet) | createUnboundedTreeFrame()
  lengths.ts            TreeLengthRule, SNAPPED_LENGTHS, CONTINUOUS_LENGTHS, hysteresis
  dragRule.ts           the rotate-and-extend transform; the t-sweep and its predicates
  dragController.ts     from lib/bpTreeDragController.ts; per-point clamp → gesture clamp
  sceneDom.ts           from lib/bpTreeSceneDom.ts, verbatim but renamed
  symmetry.ts           from lib/bpTreeSymmetry.ts; the sheet-dependent default axis moves to the host
  TreeScene.tsx         from BpTreeScene.tsx; `paper` becomes optional
  TreeEditor.tsx        from BpTreePanel.tsx, minus every store import
  TreeEdgeLengthEditor.tsx
  TreeNameEditor.tsx    from BpNameEditor.tsx
```

`lib/symmetryGeometry.ts` is already model-agnostic (`SymmetryAxis` is
`{loc, angle}`) and stays where it is. `lib/bpTreeSymmetry.ts` is *nearly*
generic already — only `bpTreeSymmetryDefaultLoc(sheet)` and its type imports
tie it to BP, so it moves and the sheet-derived default axis becomes something
the BP host computes and hands over.

The BP side keeps a thin `useBpTreeEditorHost()` beside its own modules
(`hooks/` per the AGENTS.md table), and `BpTreePanel.tsx` collapses to a
composition site: build the host, mount `<TreeEditor>`. That is the shape
`hooks/useViewportSurface.ts` already models.

#### The edge-case ledger

Each of these cost a real bug once and is easy to lose in a move. The Phase 0
review should walk this list explicitly.

1. **Focus independence.** The container-scoped `keydown` for Escape at
   `BpTreePanel.tsx:667` is exactly the pattern AGENTS.md forbids — it dies the
   moment a floating editor or a portalled menu takes focus. The extraction is
   the moment to route it through `keyboard/` and the shortcut registry, using
   `isShortcutEditingTarget` rather than a near-copy. Do not port the listener.
2. **Camera fit key.** `${document.handle}:${document.source.filename}` becomes
   `host.fitKey`. If a host returns an unstable key the camera refits on every
   edit; if it returns a constant, a newly opened design never frames. Test both.
3. **`svgRect` caching.** The rect cache is dropped on React redraw, camera
   transform, `ResizeObserver`, window scroll (capture phase) and resize. A
   gesture asking `getBoundingClientRect()` per pointer sample forces a layout of
   a thousand elements per sample. All five invalidations must survive.
4. **The ghost's rAF `ran` flag.** `scheduleGhost` handles a scheduler that runs
   synchronously (the slot is already cleared by the time `requestAnimationFrame`
   returns a handle, and storing it then drops every later sample). Preserve it;
   a test env with a synchronous rAF is where this bites.
5. **`chromePx` identity.** Read through a ref so it keeps one identity for the
   pane's life. Closing over `zoomPercent` re-renders the whole canvas per wheel
   tick.
6. **The symmetry lane is a measurement, not chrome.** `SYMMETRY_LANE_PX` scales
   with the drawing because its width *is* the snap tolerance; every other stroke
   counter-scales. Ported wrong, what you see and what snaps stop agreeing.
7. **Inline styles, not presentation attributes.** `theme.css` sets
   `stroke-width` on the same classes and would silently win.
8. **Pairing semantics, freshly landed in #209.** A pairing outlives the mirror
   toggle; a paired vertex may not cross the axis; an on-axis vertex refuses the
   drag; a pair stops short of the mirror rather than stacking on it. These are
   four separate behaviours with tests — none may change.
9. **Selection linking.** BP's `bpLinkedSelection` reaches into the BP document;
   it becomes optional, defaulting to identity, so a host without a packing view
   does not pay for it.
10. **Surface registration.** `setActiveShortcutViewportSurface('tree')` is
    generic and stays; `setOristudioBpActiveSurface('tree')` is BP-only and moves
    behind `onSurfaceFocused`. `ViewportSurface` (`keyboard/shortcutRuntime.ts`)
    needs the new surface ids.
11. **Add-anchor semantics.** A canvas click adds a leaf to *the selected vertex
    only*, with no fallback to the root — so a tree opens inert and clearing the
    selection disarms adding, which is what keeps the hover ghost and the click
    from disagreeing. Preserve exactly.
12. **The pointerdown/pointerup gesture arming.** Three different paths cancel
    the pending "add leaf" (`paperDownRef`): an edge click, an on-axis vertex
    refusing its drag, and a drag ending. Each exists because pointer capture
    retargets the rest of the gesture. Losing one means a click that adds a
    stray leaf.

#### Acceptance criterion for Phase 0

**The existing tests pass unchanged.** `BpTreePanel.test.tsx` (716 lines),
`BpTreeSceneStability.test.tsx` (399), `BpFlapEditor.test.tsx` (185) — imports
and the mount site may change; not one assertion may. A test that needs
rewriting is a behaviour change, and each one has to be justified in the PR
rather than absorbed. That is the whole safety net for a refactor this size, and
it is a good one: those files were written against the gesture and performance
bugs this component has already had.

Two additions, because they are what the extraction newly makes possible:
`tree-editor/__tests__/hostContract.test.tsx` mounts `<TreeEditor>` against a
**synchronous stub host** (proving the component does not depend on async
intents) and against a **deferred stub host** (proving it does not depend on
synchronous ones); and `lengths.test.ts` pins both presets, including that
continuous lengths accept 1.37 and snapped lengths do not.

**Phase 0 ships on its own, before anything ExplOri exists**, as a pure refactor
with a green suite as its receipt.

### Phase 0.5 — The new drag model, on box-pleat

The drag change is deliberately **not** part of Phase 0, because it invalidates
Phase 0's whole safety net: every existing test that drags radially and asserts
the length held is a specification of the *old* rule, and those assertions have
to change. Folding the two together would mean a 900-line refactor and a
behaviour change arriving in one diff with no test that distinguishes them.

So: extract first, with the old rule intact. Then change the rule, on box-pleat
alone, in its own PR — where the diff is small, the changed assertions are the
readable centre of it, and if the gesture turns out to feel wrong in the hand it
reverts without touching the extraction. ExplOri then inherits a rule that has
already been used.

Nothing upstream is at risk. Box Pleating Studio drags tree vertices as a
grid-snapped schematic with lengths authored in a side panel
(`third_party/box-pleating-studio/src/client/project/components/tree/vertex.ts`
→ `constrainVertex` on the grid). Our rotate-rigidly rule is already an Ori
Studio invention — `bpTreeAuthoring.ts` says so in as many words, and
`constrainBpTreePoint` documents the deliberate divergence to continuous
coordinates. This replaces one of our inventions with another; no parity
obligation is in play.

Testing this is mostly **property tests**, because the interesting failures are
geometric rather than enumerable. Over random trees, axes, and gestures:

- every edge *inside* the dragged subtree keeps its length exactly;
- exactly one edge's length changes, and it is the dragged one;
- the committed length is always admissible under the quantizer;
- no held vertex ever ends within `clearance` of the mirror;
- no vertex ever leaves the sheet;
- a gesture with `Δr = 0` produces exactly what the old rule produced (this is
  the one that lets the surviving rotation tests keep their assertions).

Plus targeted cases for hysteresis (sweep 1 → 2 → 1 across the midpoint and
assert one flip each way, not a stream), for the pair-lengthening commit landing
as a single undo entry, and for a pair whose partner is at `maxLength`.

### Phase 1 — The `explori` design kind

`designKinds/registry.ts` claims that adding a kind should be adding one
descriptor. That is true for the chooser, capability masking, pane layout, and
the editing context — the registry earns its keep. It is *not yet* true for the
store union, the `.osf` codec, or the shell toolbar. Adding ExplOri means
touching, honestly:

- `designKinds/explori.ts` — the descriptor.
- `designKinds/registry.ts` — one array entry.
- `store/workspaceStore/designContent.ts` — a `{ kind: 'explori'; explori: … }`
  arm on `DesignTabContent`, plus `createExploriDesignState` and a frozen empty.
- `store/workspaceStore/designTabs.ts` — `select*` accessors and the
  kind-dispatch at lines 162 / 222 / 431.
- `workspaces/editingContext.ts` — `'explori-tree'` and `'explori-results'`.
- `lib/sampleProject.ts` (`WorkflowTarget`), `analytics/events.ts`
  (`DesignVariant`, `DesignMethod`), `lib/nativeProjectFile.ts`
  (`NativeProjectDocumentKind`).
- `components/panels/PanelComponents.tsx` and `workspaces/workspaces.ts` — the
  two new pane components.
- `components/WorkspaceShell.tsx` — the toolbar is a per-kind `if` today
  (`isBpContext`, `buildCp.visible`). See the decision below on whether ExplOri
  appears there at all.

Two genuine mismatches with the descriptor interface, both worth fixing rather
than working around:

**No engine.** `DesignKindDescriptor.engine` is a required `EngineId`, and
ExplOri has no wasm engine. The field's only consumer is
`documentRegistry.ts:269`, which invalidates a kind's documents when its engine
dies — and a kind with no engine has no such death. Make it `EngineId | null`,
skip the invalidation sweep for null, and relax the `ENGINE_IDS` assertion in
`registry.test.ts`. This is more honest than inventing a `'local'` pseudo-engine
that connects to nothing.

**No handle.** The codec is handle-in / handle-out because both current engines
hold documents in wasm memory. ExplOri's document is plain JSON, so its codec is
a module-level `Map<number, string>` with a counter: `create` mints a handle,
`hydrate` validates and stores, `serialize` returns the text, `free` deletes.
That keeps the LRU / park / evict machinery uniform, and parking is nearly free.

The **consequence of parking** is the one real edge case: a park round-trips the
document through `serialize`/`hydrate`, so **anything not in the serialized
document is lost on a tab switch.** That forces the persistence decision, and it
is the one worth getting right:

- **The document holds** the drawn tree, the query settings (db configs, `n`),
  the mirror-draw state and pairs, and — for the result the user has chosen —
  its `(N, symmetry, tiling_id)` *and a copy of its geometry*.
- **The session cache holds** the rest of the result list, keyed by design id,
  in a module-level LRU outside the store.

Why that split rather than storing every result: the DB is not versioned and can
change under us, so a design whose meaning depends on re-running a query is a
design that can silently become a different design. Storing the chosen result's
geometry makes an `.osf` reproducible offline and forever, at ~8 KB. Storing the
whole list would put 40–170 KB of other people's data into every save for
results the user did not pick. And because `/api/fetch_tiling?id&N&sym` fetches
one tiling exactly, the stored triple is a durable, re-resolvable handle to the
full record — including the `refs` the query endpoint never sends.

Panes, which is where the requested layout comes from — declaratively, with no
new layout code:

```ts
panes: [
  { id: 'tree',    component: 'explori-tree',    placement: { kind: 'primary' },
    editingContext: 'explori-tree' },
  { id: 'results', component: 'explori-results', placement: { kind: 'split', direction: 'right' },
    editingContext: 'explori-results' },
]
```

`DesignPaneLayout.buildLayout` gives a `split` pane an even half and puts tab
headers on both, which is exactly right for two peers.

### Phase 2 — Transport

Given the CORS finding, the web build needs a same-origin endpoint. We already
have the machinery: `apps/web/functions/` is a Cloudflare Pages Functions tree
with tests (`functions/__tests__/cpShare.test.ts`), locally-declared binding
types, and a KV-counter rate limiter precedent.

**`apps/web/functions/api/explori/query.ts`** and **`…/tiling.ts`**:

- forward the JSON body to `https://225.designorigami.net/api/…`;
- **strip `bundle_pickle_b64` and `heat`** before responding — halves the
  payload and keeps a remote pickle out of our clients entirely;
- enforce a request timeout (`AbortSignal.timeout`) and turn upstream 4xx/5xx and
  HTML-instead-of-JSON responses into a typed error code, the way `CpShareError`
  already does;
- rate-limit per IP with the existing KV-counter pattern, so a bug in our client
  cannot hammer someone's personal server;
- cache `tiling` responses — a tiling id is immutable, so this is a pure win
  for the detail view and for reopening saved designs.

**Desktop.** Tauri has no HTTP plugin today (`apps/tauri/src-tauri/Cargo.toml`
carries only `tauri-plugin-dialog`), so a direct call means a new dependency, a
new capability, and a scoped permission. **Recommendation: route desktop through
the same Pages proxy.** One transport, one error surface, one place to change
when upstream moves — and the desktop app is no more coupled to our
infrastructure than it already is to a third-party host being up. If we later
want offline-tolerant desktop behaviour, adding `tauri-plugin-http` with a
capability scoped to that one origin is a contained follow-up, not a
prerequisite.

**Client.** `apps/web/src/explori/exploriService.ts`, modelled on
`cp-workspace/share/cpShareService.ts` — `exploriApiBase()` with a
`VITE_EXPLORI_API_URL` override for dev, a typed `ExploriError`, defensive
parsing (validate shape before trusting it; upstream is unversioned and can
change without notice), and an `AbortController` per query so editing the tree
cancels an in-flight search.

**Never auto-query.** Search is an explicit button, as it is upstream. Disable it
with a stated reason when the tree has fewer than 4 edges or no database is
selected — matching their validation so we fail locally instead of round-tripping
into a 400.

### Phase 3 — Results and detail

The results pane is a stack with two states, held in the design's own state
rather than the router. **Not a route**: `/design` is a single path and per-design
routes are already legacy (`LEGACY_DESIGN_PATHS`), so a URL-addressed detail view
would be workspace-scoped and immediately wrong with N tabs open. **Not a modal**
either: a modal covers the tree, and the whole point of the two-pane layout is
comparing your tree against a candidate.

**List state.** A card grid: thumbnail, rank, match quality, `4b.61865`-style id.
A thumbnail-mode switch (CP / packing / tree / folded) over the whole grid, as
upstream has. Each card carries a **quick Send to Edit** icon button — the
request in the brief, and the reason the detail view can stay a considered
second step rather than a required one.

**Detail state.** Back button, prev/next through the result set, and the two
configurable panes upstream settled on: left toggles CP ↔ packing, right toggles
tree ↔ folded form. Plus what we can add that they cannot: the **query tree drawn
against the result tree**, since we have both. A primary Send to Edit. And a
lazy `/api/explori/tiling` fetch for the folding **references**, which only that
endpoint returns.

**Rendering.** Four small SVG renderers (~150 lines total), ported from their
`renderers.js`. Worth noting one nicety to keep: the folded-form render uses
per-face `multiplicities` with `alpha = 1 − (1 − 0.1)^m`, so layer count reads as
opacity — cheap, and it is how their thumbnails convey depth.

**Match quality.** Take the current upstream thresholds on raw distance
(`×1000`: <0.75 great, <1.5 good, <3 acceptable, <4 poor, else terrible) rather
than the `heat`-normalized variant still lingering in their `detail.js`. Pin them
in one module with a comment naming the source, so a future divergence is
visible. Show the **tiling id and the bucket only** — the raw number stays
hidden, as it is upstream.

### Phase 4 — Send to Edit

`cp` → FOLD → `importAddOristudioCpText(text, 'fold', label, filename)`. The
descriptor's `sendToEdit(handle, request)` gets the design's handle, reads the
selected result out of the document, and converts.

Assignment mapping — **exactly what ExplOri's own FOLD export does**
(`utils.js` `getFoldType`), which needs no translation on our side because the
CP kernel already lands `'F'` on the auxiliary colour:

| ExplOri | FOLD | CP kernel | Edit canvas |
| --- | --- | --- | --- |
| `b` | `B` | `Assignment::Border` | border, black |
| `m` | `M` | `Assignment::Mountain` | mountain, red |
| `v` | `V` | `Assignment::Valley` | valley, blue |
| `h`, `aux` | `F` | `Assignment::Flat → LineColor::Cyan3` | **auxiliary**, cyan |

`Assignment::Flat → Cyan3` is `crates/oristudio-cp/src/model/mod.rs:506`, and
`LineType::Aux → Cyan3` is the same file at `:55` — so hinges arrive as
auxiliary creases, which is what we want them to read as.

The consequence to hold onto: `'h'` was 12 of 49 edges in the probe result, so
**about a quarter of a sent pattern arrives as construction lines, not creases.**
That is correct — the tiling genuinely does not determine those assignments —
but it means "send a result to Edit, then fold it in the simulator" is not a
valid acceptance check for this phase. The check is that the geometry and the
colours are right; making it fold is the user's next authoring step, and a
natural follow-up is a "resolve auxiliary creases" affordance in Edit.

**Precision is the risk here**, and we have history: a single 9.4e-5 crease once
made the Euler check discard every face, and our planarizer's 1e-8 tolerance is
four orders tighter than the kernel's 2.5e-4 weld. Three things make this case
better than usual, and one task follows from them:

- Coordinates are exact rationals in ℚ(√2), so each vertex is computed once from
  its own tuple. Two vertices with identical tuples produce **bit-identical**
  doubles, and coincidence is exact by construction rather than by tolerance.
- The CP arrives in the unit square, so the only transform is a single scale to
  the Edit paper. `SendToEditRequest.editGridDivisions` is already threaded
  through for exactly this (box-pleat uses it to map one BP cell onto one Edit
  cell).
- Their database is canonicalized (`canonicalize_cpp` / `flatten_cpp`).

The task that follows: **verify that two geometrically coincident vertices always
share a rational representation** — hash the cartesian pairs across a corpus of
fetched tilings and assert vertex count equals distinct-coordinate count. If it
ever fails, weld before export rather than hoping the kernel does it.

The check afterwards is geometric rather than behavioural, for the reason above:
send a result to Edit and confirm it arrives as the same drawing — the border on
the paper edge, mountains and valleys where the thumbnail showed them, hinges
cyan — and that CAMV/planarity report nothing our own designs would not. Folding
it flat is a later step for the user, not an acceptance criterion here.

### Phase 5 — Persistence, analytics, i18n

**`.osf` — smaller than it looks.** `validateV8` already matches
`payload.kind` **against the design-kind registry** and preserves an
unrecognized kind verbatim in `unknownDesigns`, re-emitting it on save
(`lib/nativeProjectFile.ts:816-828`). So registering the kind is what makes v8
readers accept it, and an older build meeting an ExplOri design keeps the tabs
it understands and does not destroy the rest. **No schema bump, and no new
`minimumReaderSchemaVersion` floor.**

What remains: `NativeProjectDocumentKind` gains `'explori'`, the
`document.payload` writer/reader gains its arm (the payload is just
`{kind, text, format}` — our codec's JSON, with a `format: 'explori-json'`),
and `nativeProjectDesigns.ts:62`'s extension default (`'bps'` : `'tmd5'`) gains
a third case. Round-trip tests belong beside `designTabRoundTrip.test.ts`, and
one of them should be the *older-build* case: read a file with an unknown kind,
save, and assert the design survived byte-for-byte.

**Analytics** (taxonomy in `implementation-plans/posthog-analytics.md` and
`docs/analytics.md`): lowercase space-separated names, `snake_case` properties,
enums and bucketed numbers only. Proposed:

| Event | Properties |
| --- | --- |
| `explori search` | `node_count_bucket`, `edge_count_bucket`, `db_config_count`, `result_limit`, `duration_ms_bucket`, `result_count_bucket`, `mirror_draw` |
| `explori search failed` | `reason` (enum: `network`, `timeout`, `upstream_error`, `invalid_tree`, `rate_limited`) |
| `explori result opened` | `rank_bucket`, `quality` |
| `explori sent to edit` | `source` (`card` \| `detail`), `quality` |

**Never** the tree itself, coordinates, lengths, tiling ids, or anything the user
typed. Note that `handleMenuAction` already auto-captures anything dispatched
through a `MENU_ACTION_ID`, so these hand-placed events are only for what the
chokepoint cannot express — and must not double-count anything routed through it.

**i18n.** Every new string inline as `t('ns:key', 'English')`, then
`npm run i18n:extract`, translations for all 8 locales, `npm run i18n:stamp`,
and `npm run i18n:check` green. CI enforces it.

## Affected areas

**New**

- `apps/web/src/tree-editor/**` — the extracted editor (Phase 0)
- `apps/web/src/explori/**` — service client, document model, converters,
  renderers, result cache
- `apps/web/src/components/panels/ExploriTreePanel.tsx`,
  `ExploriResultsPanel.tsx`
- `apps/web/src/designKinds/explori.ts`
- `apps/web/functions/api/explori/query.ts`, `…/tiling.ts`

**Modified**

- `apps/web/src/components/panels/BpTreePanel.tsx` → composition site;
  `BpTreeScene.tsx`, `BpNameEditor.tsx` absorbed by the module
- `apps/web/src/lib/bpTree{Authoring,Viewport,DragController,SceneDom,Symmetry}.ts`
  → moved into `tree-editor/`, BP-specific remainders kept as thin adapters
- `apps/web/src/hooks/useBpTreeSymmetry.ts` → BP's `TreeSymmetryHost`
- `apps/web/src/designKinds/{types,registry}.ts` — `engine: EngineId | null`
- `apps/web/src/store/workspaceStore/{designContent,designTabs}.ts`
- `apps/web/src/workspaces/{editingContext,workspaces}.ts`
- `apps/web/src/components/panels/PanelComponents.tsx`
- `apps/web/src/components/WorkspaceShell.tsx`
- `apps/web/src/lib/{sampleProject,nativeProjectFile}.ts`
- `apps/web/src/analytics/events.ts`
- `apps/web/src/keyboard/shortcutRuntime.ts` — new viewport surface ids
- `apps/web/src/components/DesignAttributionFooter.tsx` — ExplOri credit

**Untouched**: `crates/`, `tools/`, `third_party/`. No Rust, so `native-oracle`
is not in play for any phase.

## Decisions (settled 2026-08-06)

1. **Upstream has given the go-ahead.** Not a blocker. One thing remains before
   *merge*, not before implementation: confirm with them that the API will not
   change without notice. Their `/api/query` is unversioned, so our client
   validates the response shape defensively either way (Phase 2).
2. **No shell "Send to Edit" toolbar button**, at least at the start. Send to
   Edit is per-*result*, so a toolbar button would be disabled most of the time;
   the result card and the detail view own it. `WorkspaceShell`'s per-kind `if`s
   do not grow a third arm.
3. **Mirror draw defaults on**, book fold — which is what box-pleat already
   does: `defaultBpDocumentSymmetry()` returns `{enabled: true, fold: 'book'}`
   ("Mirror draw as a new design starts: on"). ExplOri matches it. *(An earlier
   draft of this plan said the BP tree opens with mirror draw off. It does not.)*
4. **Snap deadband `h = 0.08` tree units**, as one named constant. At the
   default zoom a unit is `TARGET_UNIT_PX = 56` px, so that is ≈ 4.5 px of
   travel past the midpoint — clear of hand tremor, well short of sticky. Tune
   it in the browser once it is live.
5. **Keep box-pleat's sheet and scale exactly as they are.** *(This replaces an
   earlier "should box-pleat keep the tree sheet clamp at all?" — it should; see
   "The tree sheet is load-bearing" above.)* The default tree sheet is **20×20**
   (`crates/oristudio-bp/src/model.rs:34`) against a 16×16 layout sheet, and a
   unit renders at 56 px. So the drag-length ceiling the new rule introduces is
   ~20 units from an edge and ~10 from a centred root, against flaps that are
   typically 1–5. It is a real coupling but not a practical limit, and typing a
   length still bypasses it. No tree-sheet resize work.
6. **`'h'` and `'aux'` → FOLD `'F'` → auxiliary**, which is exactly what ExplOri
   already exports (`utils.js` `getFoldType`) and lands correctly with no
   translation on our side: `Assignment::Flat → LineColor::Cyan3`
   (`crates/oristudio-cp/src/model/mod.rs:506`) and `LineType::Aux → Cyan3`
   (`:55`). Verified in code rather than by inference. One consequence, below.
7. **Follow upstream on match quality**: show the tiling id and the quality
   bucket, hide the raw `distance`.

## Open questions (resolve during implementation, not before)

- What `N` means precisely in the database matrix (leaf count? corner count?),
  and whether the UI should suggest configs from the drawn tree. Their `5 book
  ⇒ also 6 book` quirk must be reproduced either way.
- Whether `/api/result/<query_id>` is worth using — it would let the detail view
  re-read a bundle without re-querying, but it is server-memory-backed and
  therefore not durable. Probably not; our session cache is strictly better.
- Whether ExplOri designs should offer Duplicate. Duplicating a search is
  cheap and harmless; duplicating a *result* is meaningless. Likely allow it.

## Checklist

*All phases implemented and committed on `claude/explori-design-type-plan-e3a0fa`
(five commits, branched from PR #211). Three items were deliberately not done and
are marked below.*

### Phase 0 — reusable tree editor

- [x] Create `apps/web/src/tree-editor/` and move the pure geometry modules
      (`authoring` → `dragRule`, `dragController`, `sceneDom`, `symmetry`) with
      no behaviour change
- [x] Define `EditableTree`, `TreeSelection`, `TreeFrame`, `TreeLengthRule`,
      `TreeEditorHost`, `TreeSymmetryHost`
- [x] `createPaperTreeFrame(sheet)` and `createUnboundedTreeFrame()`; remove
      every `sheet` reference from the component layer
- [x] Ship `SNAPPED_LENGTHS` and `CONTINUOUS_LENGTHS`; length editor reads the
      rule for min / max / step / quantize / format, and the ± buttons become
      proportional when `step` is null
- [x] Extract `TreeScene` with `paper` optional, preserving the memo contract
      and the scaling rules (lane scales, chrome counter-scales, inline styles)
- [x] Extract `TreeEditor`, replacing store calls with host intents
- [x] Move the container Escape listener into `keyboard/`, using
      `isShortcutEditingTarget`
- [x] Add BP's `useBpTreeEditorHost`; reduce `BpTreePanel` to composition
- [x] Walk the 12-item edge-case ledger in review
- [x] `BpTreePanel.test.tsx`, `BpTreeSceneStability.test.tsx`,
      `BpFlapEditor.test.tsx` pass with **no assertion changes**
- [x] New `hostContract.test.tsx` (sync host and deferred host) and
      `lengths.test.ts`
- [x] Ship Phase 0 as its own PR

### Phase 0.5 — new drag model (box-pleat, own PR)

- [x] Rotate-and-extend transform in `dragRule.ts`; `Δr = 0` reproduces the old
      result bit-for-bit
- [x] Integer quantizer with per-session hysteresis (`h ≈ 0.08`), reset per drag
- [x] Replace `clampRotationToMirror` with the `t`-sweep (coarse step + bisect)
      over the composed transform
- [x] Move the sheet clamp onto the same sweep; stop clamping points
      individually, which silently distorted swung subtrees
- [x] Quantize the achieved `r`, re-validate, step down one admissible value on
      failure
- [x] BP slice accepts a *list* of edge-length changes so a mirrored
      lengthening is one undo entry; clamp a pair to the tighter `maxLength`
- [x] Click-to-add and the hover ghost use `quantize(|click − parent|)`; the
      ghost shows the length as a number
- [x] `sceneDom` writes the dragged edge's label text live, for any edge type
- [x] Hold the last direction when the cursor is on the pivot
- [x] Property tests: subtree rigidity, single length change, admissible length,
      mirror clearance, sheet containment, `Δr = 0` equivalence
- [x] Flap seeding still lands where the leaf was drawn, and now honours the
      click's *distance* as well as its direction — browser-check by
      hand-packing a small model without touching the optimizer
- [x] Targeted tests: hysteresis flip count, mirrored-lengthening undo entry,
      partner at `maxLength`
- [x] Update the BP drag assertions that specified the old rule, and say in the
      PR why each one changed

### Phase 1 — design kind

- [x] `engine: EngineId | null`; registry skips engine-loss for null;
      `registry.test.ts` relaxed
- [x] `designKinds/explori.ts` with the JSON-map codec
- [x] `DesignTabContent` arm, `createExploriDesignState`, `designTabs` accessors
- [x] `'explori-tree'` / `'explori-results'` editing contexts; new viewport
      surface ids
- [x] Two panes registered in `PanelComponents` / `workspaces.ts`
- [x] Chooser card (title, blurb, icon, order, availability)
- [x] Capability mask: hide TreeMaker/BP/CP commands that mean nothing here
- [x] `designTabWrites.test.ts` and `designIsolation.test.ts` cover the new kind

### Phase 2 — transport

- [ ] Before merge: confirm with upstream that the API won't change unannounced
      (permission itself is already granted)
- [ ] Ask upstream to drop or gate `bundle_pickle_b64` — 47% of every response,
      unread by their own client, and CPU on their hot path
- [x] `functions/api/explori/{query,tiling}.ts` — forward, strip
      `bundle_pickle_b64` + `heat`, timeout, typed errors, KV rate limit,
      cache tilings
- [x] Function tests beside `functions/__tests__/cpShare.test.ts`
- [x] `exploriService.ts` — base URL override, defensive parsing, `AbortController`
- [x] Search button gated on ≥4 edges and ≥1 database, with a stated reason
- [ ] Confirm our tree unit is their tree unit: send one tree at two scales and
      check the results differ (the embedding is not scale-invariant)
- [x] First-use notice that queries leave the machine; attribution footer

### Phase 3 — results and detail

- [x] Results grid with thumbnail-mode switch and quick Send to Edit per card
- [x] Detail state: back, prev/next, CP↔packing and tree↔folded panes,
      query-tree comparison, references via the tiling endpoint
- [x] SVG renderers for CP, packing, folded form (with multiplicity alpha), tree
- [x] Match-quality thresholds pinned in one module, source named
- [x] Session result cache keyed by design id; survives tab switch and park

### Phase 4 — Send to Edit

- [x] `cp` → FOLD converter with the assignment table, unit tested against a
      captured fixture bundle
- [x] Scale to `editGridDivisions`; `sendToEdit` reads the selected result
- [x] Coincident-vertex hash check across a corpus of fetched tilings
- [x] End-to-end: send a result to Edit and confirm the drawing matches the
      thumbnail — border on the paper edge, M/V placed, hinges cyan/auxiliary

### Phase 5 — persistence, analytics, i18n

- [x] Document schema: tree + settings + symmetry + selected result (identity
      and geometry); JSON round-trip test through park/hydrate
- [x] `.osf`: `NativeProjectDocumentKind` arm, payload reader/writer,
      `nativeProjectDesigns` extension default
- [x] Older-build round trip: a file with an unregistered kind survives
      read → save byte-for-byte via `unknownDesigns`
- [x] Four analytics events, properties enum-or-bucketed only
- [x] i18n extract, 8 locales, stamp, `i18n:check` green

### Validation

- [x] `npx tsc --noEmit`, `npm run lint:web`, web unit tests, `npm run build:web`
- [x] `npm run check:desktop`
- [x] Browser: two designs open (one BP, one ExplOri) — edits in one leave the
      other byte-identical; a tab switch and back preserves results and selection
- [x] Browser: mirror draw in the ExplOri tree pairs, moves, and unpairs exactly
      as it does in BP

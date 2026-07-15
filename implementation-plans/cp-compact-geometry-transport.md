# CP compact geometry transport — make editing near-instant on large documents

## Goal

Make crease-pattern commands (draw / delete / move / select / …) feel instant on a
large document (~52k line segments), where each command currently costs **~231ms** of
pure sync overhead regardless of edit size.

**Measured** (52k-edge doc, `perf_harder.osf`, worker `document_snapshot` round-trip
timed from the main thread):

| Per-command round-trip | Cost |
| --- | --- |
| `loadDocument` (deserialize a full doc into the kernel) | ~275ms |
| `snapshot` (serialize the full doc back out) | ~231ms |

Every mutating command runs `executeCommand` → `refreshOristudioCpDocument` →
`api.snapshot(handle)`, so the ~231ms is paid on **every edit**, changing nothing about
the edit size.

Target: per-command sync overhead **~231ms → <16ms** (near-instant) at 52k edges, with
**no behavioral regression** — this plan treats correctness as the primary constraint.

## Root cause (why 231ms)

`api.snapshot` pays two O(document) costs, neither fundamental:

1. **`serde_wasm_bindgen` builds a JS object graph** — it materializes ~52k nested
   segment objects (`{a:{x,y}, b:{x,y}, color, active, selected, customized,
   customized_color:{…}}`): hundreds of thousands of JS allocations inside the worker.
2. **Structured-clone transfer** — comlink returns that graph via `postMessage`, which
   deep-copies it from worker → main thread. A second full O(document) pass.

Both disappear if the document geometry crosses the boundary as **flat typed arrays in
transferable `ArrayBuffer`s** (packing numbers in a tight loop; transferables move
ownership instead of copying). The bulk (segments) is exactly what the renderer and
hit-test want as flat arrays anyway.

## Architecture

Add a **compact geometry codec** alongside the existing structured snapshot; do **not**
remove the structured snapshot. It becomes:

- **Compact geometry** (typed arrays + a small structured tail) — the **hot path**:
  produced on every edit, consumed by rendering, hit-testing, vertex dots, bounds,
  snapping, and the per-id handler lookups. Also the storage form for undo/redo history.
- **Structured `document_snapshot`** (today's `to_js_value` JSON-ish object) — the
  **cold path**: kept unchanged, fetched only for **save / export** (rare, not
  per-edit). Remains the human-auditable source of truth and the oracle the compact
  path is validated against.

Frontend geometry stops being an `OristudioCpLineSegment[]` array of objects and becomes
a **`CpGeometry` accessor** over the typed arrays, supporting both iteration (render /
index) and random access by id (`geometry.segment(id)`), with **zero per-segment JS
object allocation** on the hot path.

### Why keep the structured snapshot at all

- Save/export need the full JSON structure and are cold — no need to optimize them.
- It is the **known-correct oracle**: every field of the compact codec is asserted equal
  to the structured snapshot in a golden parity test. We never trust the compact format
  on its own; we prove it equivalent.
- It is the **fallback**: during rollout the structured path can still drive rendering if
  the compact path is disabled, so a bug is degrade-to-slow, not degrade-to-wrong.

## Data format (the compact codec)

One kernel call returns everything a hot-path frame needs, atomically (same kernel
state), as transferables:

```
CpGeometryTransport {
  // --- line_segments (the bulk) ---
  segCount: u32
  segEndpoints: Float64Array   // [ax, ay, bx, by] × segCount   (EXACT f64 — see below)
  segAttr:      Int32Array     // [color, active, customized] × segCount (enum codes)
  segCustomColor: Uint8Array   // [r, g, b] × segCount (only meaningful when customized)
  // NOTE: `selected` is deliberately NOT here — see "Selection" below.

  // --- aux_line_segments (same layout) ---
  auxCount, auxEndpoints, auxAttr, auxCustomColor

  // --- standalone points ---
  pointCount: u32
  pointCoords: Float64Array    // [x, y] × pointCount

  // --- circles ---
  circleCount: u32
  circleData:  Float64Array    // [x, y, r] × circleCount
  circleAttr:  Int32Array      // [color, customized] × circleCount
  circleCustomColor: Uint8Array

  // --- small structured tail (low count / non-numeric) ---
  tail: {
    texts: { x, y, text }[]     // strings — cannot be typed arrays; always tiny
    grid: OristudioCpGridMetadata
    operationFrame?: {...}
    title, metadata
    selection: { lines, points, circles, texts, faces: number[] }  // post-command selection (id lists)
  }
}
```

Circles and points are typed arrays (`circleData`/`circleAttr`, `pointCoords`) — circles are
used heavily and must stay performant at high count, so they are not left in the structured
tail. Only `texts` stays structured (its payload is a string).

Decisions baked into the format for correctness:

- **Coordinates are `Float64Array` (exact `f64`), never `f32`.** The kernel and the
  structured snapshot use `f64`; origami geometry is precision-sensitive (vertex
  coincidence, 22.5° snapping, intersection/division, fix-inaccurate). We convert to
  `f32` **only** at GPU upload (the renderer already does `cpSnapshotToScene` →
  `Float32Array`), exactly as today. **No coordinate ever loses precision on a path that
  can feed back into a command or a snap target.** (2× the bytes vs f32 — still a few MB,
  still transferable, still fast.)
- **Enum codes are defined once in Rust** (the `LineColor` / `Active` / etc. enums
  already have discriminants) and decoded on the TS side by a single generated/asserted
  table. A test enumerates *every* enum value round-trip.
- **Order == kernel `Vec` order == structured-snapshot order.** All ids are `index + 1`
  (matching the SVG-era convention every consumer still uses). Selection ids, hit-test
  ids, and history all key on this, so the export must preserve ordering; the parity test
  asserts index correspondence.
- **Transferables are freshly allocated each export** (a transferred buffer is neutered
  in the worker) — never reuse a buffer across exports.

## Selection (stays frontend-owned — do not bake into geometry)

Selection is carried as an **id list in the tail**, and `selected` is **not** a per-segment
attribute in `segAttr`. The reason is a real architectural corner:

- Selection is already **frontend-owned state** (`oristudioCpSelection`, per-type id lists).
  The renderer highlights by building a `Set` of selected ids from that state and recolouring
  at scene-build (`cpSnapshotToScene(selection)`), *not* by reading a per-segment kernel flag.
- If `selected` lived in the geometry buffer, a **pure selection change (a click, no geometry
  edit) would have to touch the geometry** — either a kernel round-trip to update flags (an
  O(doc) trip on every click — worse than what we're fixing) or local mutation of the geometry
  buffer that the next real fetch would clobber (out-of-sync, fragile).
- The compact format only needs to tell the frontend the **post-command** selection (some
  commands change it, e.g. select-the-result) so the frontend mirror stays in sync — an id
  list is exactly that, and small in the common case (a select-all is the only large case, and
  can get an "all" sentinel later if it matters).

**This keeps selection decoupled from geometry, which is the future-proof choice.** Anything
the UI might later want — hover highlight, selection groups, multi-select modes, a different
selection visual, marquee refinements — is then a **frontend-only** change with no kernel or
wire-format entanglement. It also *enables* (doesn't require) a later rendering win: a small,
separate per-instance selection attribute so selection changes stop rebuilding all geometry
buffers — impossible if selection were fused into the kernel geometry.

Baking `selected` into `segAttr` would do the opposite: couple a frequent, should-be-instant
UI interaction to the geometry pipeline and the kernel wire format.

## Consumer inventory (what reads the document today)

**Hot (per edit) — must move to `CpGeometry`:**
- `cpSnapshotToScene` / `cpPointsToScene` (render buffers) — `apps/web/src/cp-workspace/adapters/`
- `LineHitIndex` build (pointer picking) — `CreasePatternWebglCanvas` (`hitIndex`, `pointIndex`)
- `getCpVertexPoints` (vertex dots) — `creasePatternViewport.ts`
- content/geometry bounds
- selection sync after a command (`selectedLineSelectionFromDocument`) — reads `selected`

**Hot-ish (per interaction) — must read `CpGeometry`, precision-sensitive:**
- `nearestCpSnapTarget` / `nearestOrieditaDrawPointTarget` (snapping) — iterate all
  segments/points/circles; **must use exact f64** (feeds snapped points back into commands)
- `line_segments[id - 1]` random lookups in handlers (reflect/lengthen build payloads from
  a segment's endpoints) — `CreasePatternPanel.tsx`, `creasePatternClipboard.ts`

**Cold — stay on the structured snapshot:**
- save / export (`exportOristudioCpDocumentAs*`, `document_snapshot`)
- measure (already kernel-side via `preview.measurement` — does not need the doc)
- `.length` counts (already available from `document_summary`)

## Undo/redo (the correctness wrinkle)

Undo/redo currently **store the structured document snapshot per edit** (`MAX_HISTORY = 100`
entries of `{ document, selection, label, timestamp }`) and restore via
`restoreOristudioCpDocumentInPlace(previous.document)`. There is **no kernel-side undo** —
it is entirely frontend-owned. If edits stop producing a structured snapshot, there is no
restore point, so this must be addressed as part of the refactor.

### Option A — frontend history holds compact snapshots (chosen for this plan)

Keep the existing frontend-owned architecture (store snapshot → restore snapshot); swap the
*encoding* from structured to compact. **The per-edit compact geometry we already fetch for
rendering is a complete, round-trippable snapshot, so it doubles as the undo entry — no
extra per-edit work.** Requires only a kernel `restore_from_compact(transport)` (which we
need anyway for the round-trip identity gate).

- **Effort:** small on top of the codec — reuses the per-edit fetch; add `restore_from_compact`;
  change `cpHistoryEntry` to store the compact buffers instead of the JS object.
- **Correctness:** guarded by the round-trip identity gate; same undo flow as today, so undo
  behavior is unchanged.
- **Memory:** O(doc) per entry × 100 in JS (transferable `ArrayBuffer`s ≈ ~2.6MB per snapshot
  at 52k edges → ~260MB at full depth). This is **better than today** (structured JS object
  graphs are larger per element), and bounded; if it bites on huge docs, lower `MAX_HISTORY`
  for large docs or move to Option B.
- **Restore cost:** undo does a full `restore_from_compact` (O(doc), but cheap with typed
  arrays). Undo is infrequent vs edits, so this is fine.

### Option B — kernel-owned undo stack (deferred; larger, cleaner)

The kernel keeps its own undo stack per handle: on each *mutating* command it clones the
pre-state; `undo_command`/`redo_command` restore it. The frontend keeps only a lightweight
label stack synced to kernel undo depth (the kernel doesn't know UI labels), re-derives its
selection mirror after a restore, and reads can-undo/can-redo from kernel state.

- **Pros:** edits store nothing in JS for undo (the kernel clones internally — a cheap Rust
  clone, no serde); undo/redo are fast kernel ops; restores are **bit-exact** (no serde
  round-trip at all); and with *delta/inverse-command* undo it becomes **O(edit-size) memory**
  instead of O(doc)×depth.
- **Cons / effort:** net-new kernel subsystem — undo stack + per-command record (must exclude
  read-only checks like `CheckCamv`) + undo/redo ops + label/selection sync + Rust tests
  (**~kernel: 3–4 days**); plus gutting the frontend CP-history slice and rewiring the undo
  actions/capabilities/tests (**~1–2 days**). With *full clones* (not deltas) its memory is the
  same order as Option A, just in wasm — so the memory win only materializes with delta undo,
  which is the most work.
- **Interaction with unified history:** the app's `undo`/`redo` route by `activeEditingSurface`
  (tree vs CP); only the CP branch changes — the tree branch and the coordinator stay.

### Recommendation

Ship **Option A** with the refactor: it reuses the per-edit compact fetch, keeps undo behavior
identical, and adds only `restore_from_compact`. Treat **Option B** (ideally delta-based) as a
**separate follow-up** justified by memory/undo-latency measurements on real large-doc sessions,
not upfront — it's a ~1-week project on its own and its memory advantage only lands with deltas.

## Follow-ups (out of scope here, tracked)

- **`CheckCamv` costs ~268ms per action** (deferred, off the critical path, but still heavy
  worker time that can stall rapid edits). Fix B removed its O(E·V) `point_line_map`, but a
  ~268ms residual remains — hypothesis: building + serde-serializing one `CommandDiagnostic`
  per flat-foldability violation (a dense pattern has many), the same serde-object-graph cost
  as the document snapshot. Candidate fixes (all smaller than this refactor): cap the number of
  violations surfaced (thousands of markers is unusable UX anyway), skip the recompute when the
  CAMV overlay is hidden, and/or reuse this plan's compact encoding for the diagnostics result.
  Pin down compute-vs-serialize with a timing pass in the Rust `CheckCamv` handler before
  choosing. Not on the felt-latency critical path, so sequenced after the transport refactor.

## Correctness & regression analysis (primary concern)

Every risk below is validated against the **structured snapshot as oracle**. Two test
gates carry most of the weight:

- **Parity gate:** for a battery of representative documents, decode the compact geometry
  and assert it is **field-for-field equal** to the structured snapshot (coordinates
  bit-exact, every enum, `selected`, `customized`, `customized_color`, ids/order, points,
  circles, texts, grid). Runs in CI.
- **Round-trip identity gate:** load a doc → compact-snapshot → `restore_from_compact` →
  `document_snapshot` and assert it equals the original structured snapshot. This guards
  undo/redo and any restore path.

Representative-document battery: empty; single segment; dense box-pleat (~50k);
every line color / assignment (M/V/aux/border/cyan/custom types); customized colors;
aux_line_segments present; circles (plain + customized); texts (incl. unicode); points;
degenerate/duplicate coordinates; extreme magnitudes; NaN/inf if reachable.

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | **f64 → f32 precision loss** (snap targets / payloads corrupt exact geometry; vertices stop coinciding) | `Float64Array` for all coordinates; `f32` only at GPU upload. Parity gate asserts bit-exact coords. A targeted test: draw a line snapped to an existing vertex → the kernel merges them (same as today). |
| 2 | **Enum mis-encoding** (wrong color/type/assignment) | Single Rust-defined code table; TS decoder asserted against it for *all* variants; parity gate covers every color/active/customized combination. |
| 3 | **Id / order drift** (selection, hit-test, history key on `index+1`) | Export strictly in kernel `Vec` order; parity gate asserts index correspondence; selection round-trip test after a command. |
| 4 | **Selection desync** after a command | `selected` in `segAttr`; parity gate + a select→edit→assert-selection test. |
| 5 | **Undo/redo restores a different state** | Compact format is complete; round-trip identity gate; existing undo/redo store test extended to compare full geometry before/after an undo cycle. |
| 6 | **Save/export changes** | Save/export keep using the *unchanged* structured snapshot. Add a test asserting exported bytes are unchanged for the battery (they never touch the compact path). |
| 7 | **Texts (strings) lost/garbled** | Texts live in the structured tail (never typed arrays); parity gate includes unicode. |
| 8 | **Transferable neutering / stale buffers** | Fresh allocation per export; a test that two consecutive exports both yield valid data; never read a buffer after transfer on the worker side. |
| 9 | **Atomicity** (geometry + tail + selection from different kernel states) | One kernel call returns everything for a frame; the async CAMV refresh is already document-guarded and unaffected. |
| 10 | **Circle/point attribute gaps** (radius, customized color) | All attributes in the format; parity gate covers circles/points explicitly. |
| 11 | **`operation_frame`, `grid`, `metadata`, `title`** dropped | Carried in the tail; parity gate covers them. |
| 12 | **Consumer rewrite bugs** (a call site reads the wrong field via the accessor) | `CpGeometry` accessor is a thin, unit-tested wrapper; migrate consumers behind a flag with the structured path as A/B oracle until parity holds. |

**Safety net / rollback:** a runtime flag selects compact vs structured for the render/
interaction path. The structured snapshot is never removed, so any compact-path defect is
"fall back to slow," never "wrong." Flag stays until the gates are green and the author
has signed off, then compact becomes the default and (later) the flag is removed.

## Phased plan

Each phase ends at an author-verified gate (this is a correctness-first change; no phase
advances on an unverified gate).

- **Phase 1 — Codec + parity, no behavior change.**
  - Kernel: `document_geometry()` → `CpGeometryTransport` (transferables); `restore_from_compact()`.
  - Frontend: `CpGeometry` accessor + typed decode; comlink `transfer` wiring.
  - **Parity gate** + **round-trip identity gate** green on the full battery.
  - Nothing consumes the codec yet. *De-risks the encoding before any rewire.*

- **Phase 2 — Hot path on `CpGeometry` (flagged, structured still fetched).**
  - Rewire render (`cpSnapshotToScene`/`cpPointsToScene`), `getCpVertexPoints`, hit/point
    index, bounds, snapping, and the `line_segments[id-1]` handlers to `CpGeometry`.
  - Structured snapshot **still fetched per edit** so selection/undo are untouched; the two
    representations run **side by side** (A/B) and the parity gate guards them.
  - Gate: visual + interaction parity on representative docs; snapping/hit-test correctness
    (esp. dense/close-pair); no coordinate drift.

- **Phase 3 — Demote the structured snapshot off the hot path (the win).**
  - Per-edit sync fetches **only** compact geometry (+ selection/counts); `refreshOristudioCpDocument`
    no longer calls `document_snapshot` on the edit path.
  - Undo/redo store + restore compact snapshots (`restore_from_compact`).
  - Structured snapshot fetched only for save/export.
  - Gate: **measured** per-command overhead <16ms on the 52k doc; save/export/undo/redo
    verified; full suite green.

- **Phase 4 — Cleanup.** Remove the flag + any dead structured-per-edit code; final
  prod-build profile (React DevTools off) to confirm the end-to-end per-edit budget.

## Open decisions

- **Undo ownership:** decided — Option A (frontend compact snapshots) for this refactor;
  kernel-owned undo (Option B) is a measured follow-up. See the undo section above.
- **Circles/points/texts encoding:** decided — circles and points are **typed arrays**
  (circles are used heavily; keep them fast at high count). Only `texts` stays structured
  in the tail (string payload).
- **Selection:** decided — **id list in the tail only; not in `segAttr`.** Keeps selection
  frontend-owned and decoupled from geometry (see the Selection section). Avoids a kernel
  round-trip on every click and leaves future UI selection changes unconstrained.

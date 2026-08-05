# FOLD Import Integrity

## Goal

Make opening a `.fold` file either produce the document the file describes, or
fail loudly. Today it can do neither: spec-valid files are rejected outright,
and malformed ones are silently reshaped into different geometry that is
presented as a successful open.

Four defects, all in the FOLD import path, all reproduced against `main` as of
this branch's merge:

| Bug | Trigger | Result |
| --- | --- | --- |
| A | Canonical multi-frame FOLD (geometry in `file_frames[0]`) | `missing field vertices_coords` — file will not open |
| B | Valid root geometry + a frame omitting `edges_vertices` | `missing field edges_vertices` — rejected despite valid root |
| C | One malformed `vertices_coords` entry | Every later vertex index shifts; geometry silently destroyed |
| D | One out-of-range `edges_vertices` entry | Every later crease assignment shifts; valleys import as mountains |
| E | Cyclic `frame_parent` | `Maximum call stack size exceeded` |

C and D are a **third and fourth instance of the class**
`implementation-plans/fold-per-edge-array-integrity.md` set out to close in
July ("This plan addresses the class rather than patching a third instance
later"). That plan built `apps/web/src/lib/foldEdgeArrays.ts` and adopted it in
the three *rebuild* sites — `buildSegmentFold`, `inferTopology`,
`foldedFoldDocument`. It did not cover the *import filter*, which is a different
shape of the same mistake and where C and D live. It also only owns per-edge
arrays; the vertex-index invariant that C violates has no owner at all.

## Reproductions

Executed against `parseImportedCreasePattern` and
`oristudio_cp::io::fold::import_fold_file_document_json` on the merged branch.

**C — a decorative vertex destroys the sheet.** A square (`v0,v2,v3,v4`) plus one
isolated vertex `v1` that no edge references and that lies on no edge:

| `v1` | vertices out | edges out | shape |
| --- | --- | --- | --- |
| `[90,310]` (valid) | 4 — `(0,0) (1,0) (1,1) (0,1)` | 4 | closed square |
| `[400]` (short) | **3** — `(1,0)` gone | **2** | open polyline |
| `["x","y"]` | **3** | **2** | open polyline |

The extra diagnostics read `"No bounded faces could be inferred; simulation is
unavailable"`.

**D — one bad edge shifts crease types.** Five edges assigned `B,M,V,B,F`, edge
index 1 made out-of-range:

| | `0-1` | `0-2` | `0-3` | `2-3` |
| --- | --- | --- | --- | --- |
| control | B | F | B | V |
| one invalid edge | B | **B** | **V** | **M** |

## Approach

### 1. Kernel: stop requiring geometry on every frame (A, B)

`crates/treemaker-fold/src/lib.rs:157-158` — `vertices_coords` and
`edges_vertices` are the only two fields on `FoldDocument` without
`#[serde(default)]`. Because `file_frames: Vec<FoldDocument>`, that makes them
mandatory on the root **and on every embedded frame**, which the FOLD spec does
not require and which two of the commonest real file shapes violate.

Add `#[serde(default)]` to both. Deserialization then stops being the place
geometry is validated, so move that judgement to the semantic layer: a document
with no usable frame should return a typed `IoError` naming the problem, not a
serde message about a missing field.

Do **not** add `skip_serializing_if` to these two — they are required on
*output* for a valid single-frame FOLD, and the export path round-trips today
(verified: export -> re-import preserves frames).

### 2. Web: give the import filter the same provenance discipline as the rebuild sites (C, D)

`apps/web/src/lib/creasePatternImport.ts:391-404` filters three arrays
independently and never remaps the indices that point into them:

```ts
const rawCoords = arrayField(frame.vertices_coords)
  .filter(Array.isArray)
  .map(...)
  .filter((coord) => coord.length >= 2 && coord.every(Number.isFinite));   // (C)
const coords = normalizePoints(rawCoords.map(coordToPoint));
const edges = arrayField(frame.edges_vertices)
  .filter(...)
  .filter((edge) => edge.every((v) => ... && v < coords.length));          // (D)
const assignments = normalizeAssignments(arrayField(frame.edges_assignment), edges.length);
```

Two separate index spaces are broken here, so fix both explicitly rather than
patching the symptom:

- **Vertex space.** Build `vertexRemap: Array<number | null>` from the original
  vertex list while filtering. Any edge or face referencing a dropped vertex is
  itself dropped; surviving references are rewritten through the remap. Note
  the current `v < coords.length` test is doubly wrong — it validates original
  indices against the *shortened* array, so it both admits wrong references and
  rejects valid high ones.
- **Edge space.** Collect `sourceEdgeIndices` while filtering edges, then index
  `edges_assignment` / `edges_foldAngle` through it instead of positionally, and
  pass it to the existing `remapEdgeExtensionArrays` for the namespaced arrays.

`foldEdgeArrays.ts` already owns the per-edge half and documents exactly why
provenance rather than length is the right signal. Extend that module to own
the vertex half too (`remapVertexReferences`, or similar) so there is one place
this invariant lives, matching the intent of the earlier plan.

### 3. Web: detect `frame_parent` cycles (E)

`creasePatternImport.ts:342` walks `frame_parent` with no visited set. Carry one
and treat a repeat as a malformed file — a typed diagnostic, not a stack
overflow. A self-parent (`frame_parent` pointing at the frame's own index) and a
two-frame cycle both reproduce today.

### 4. Make the warnings reachable

The importer already records `"Some FOLD vertices were ignored…"` and `"Some
FOLD edges were ignored…"`. Nothing surfaces them, and
`implementation-plans/failed-load-error-surfacing.md` covers why. That plan is a
prerequisite for this one being *observable* — without it, a partially-dropped
import still looks clean. Land them together.

## Affected Areas

- `crates/treemaker-fold/src/lib.rs` — serde defaults on the two geometry fields
- `crates/oristudio-cp/src/io/fold.rs` — semantic "no usable frame" error
- `apps/web/src/lib/creasePatternImport.ts` — `normalizeFoldObject` filters,
  frame-parent walk
- `apps/web/src/lib/foldEdgeArrays.ts` — extend to own the vertex-index remap
- `apps/web/src/generated/oristudio-cp-wasm/**` — tracked bridge; must be rebuilt
  and committed or the kernel change never reaches the app or CI
- `tests/fixtures/` — new FOLD fixtures for the multi-frame and malformed shapes

## Checklist

- [ ] Add FOLD fixtures: canonical multi-frame, root-plus-frame, malformed
      vertex, out-of-range edge, self-parent frame, two-frame cycle
- [ ] Rust: `#[serde(default)]` on `vertices_coords` / `edges_vertices`
- [ ] Rust: typed "no usable frame" error replacing the serde-missing-field path
- [ ] Rust: tests for both multi-frame shapes + the existing single-frame control
- [ ] Rust: confirm export -> re-import still round-trips with frames preserved
- [ ] Web: vertex remap in `normalizeFoldObject`, with edges/faces rewritten or
      dropped through it
- [ ] Web: `sourceEdgeIndices` provenance for `edges_assignment` /
      `edges_foldAngle` / extension arrays
- [ ] Web: move the vertex-index invariant into `foldEdgeArrays.ts`
- [ ] Web: `frame_parent` cycle detection with a typed diagnostic
- [ ] Web: regression tests asserting the two tables in **Reproductions**
- [ ] Rebuild and commit the tracked `oristudio-cp-wasm` bridge
- [ ] Validate: `cargo fmt --check`, `cargo clippy`, `cargo test --workspace`,
      web lint/typecheck/test
- [ ] Open draft PR against `main`

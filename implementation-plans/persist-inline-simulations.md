# Persist Inline Simulation Windows

Phase 7 of `inline-simulation-windows.md`, deferred there on purpose. The data
model was built for this, so the question is not whether it fits but what a
window is worth restoring *as*.

## Goal

Reopening an `.osf` brings back the simulation windows that were on the canvas:
where they were, how big, how rotated, which region each was of, and whether it
still matches the creases.

Not in scope: restoring the fold *position* each window was at. See
"Deliberately not saved" — that is the part with the interesting trade, and it is
being left out for now.

## What gets saved

The descriptor, unchanged from what the store already holds:

| field | notes |
| --- | --- |
| `id` | |
| `box` | centre, size, rotation, in crease-pattern model space |
| `z` | stacking against other canvas objects |
| `view` | the orbit camera — yaw, pitch, zoom |
| `sourceBoundary` | the region's rings; the durable identity |
| `sourceBounds` | bounding box; prefilter and reselection key |
| `sourceFingerprint` | 20 bytes since #151 hashed it |
| `segmentIdHint` | fast path only, never authoritative |

Measured against merged main:

| boundary points | one window | twenty |
| --- | --- | --- |
| 4 (a square) | 437 B | 8.5 KB |
| 12 | 660 B | 12.9 KB |
| 40 (dense cell) | 1.4 KB | 28 KB |
| 120 | 3.6 KB | 70 KB |

`sourceBoundary` is now the only term that grows — ~25 bytes per point — because
hashing the fingerprint removed the term that used to dominate (a dense region
carried 95 KB of fingerprint alone before #151). Nothing here needs further
shrinking; if it ever does, the boundary is the target.

## What does not get saved, and why

**The fold mesh.** Measured at ~112 bytes per vertex of FOLD JSON, so a dense
region runs to hundreds of KB and twenty windows to ~10 MB. It stays in
`inlineSimulationRuntime` and is rebuilt on load.

Two reasons beyond size, either of which would be enough:

- **It can contradict the document.** Restore a mesh into a file whose creases
  changed and the picture and the pattern actively disagree. The descriptor
  cannot have that problem — everything about the fold is re-derived from
  whatever the CP now says.
- **Positions alone cannot resume.** The solver carries velocities too. Restoring
  positions gives a correct still image that jerks on the first tick as the
  solver re-finds equilibrium — worse than starting somewhere honest.

## Approach

### The rehydration path already exists

`refreshOristudioCpInlineSimulation` does exactly what loading needs: take a
descriptor, resolve it to a region by boundary matching, rebuild the fold into
the side table. Loading is that, minus two things it does that load must not.

### The trap: load must not refresh provenance

Refresh recomputes `sourceFingerprint` from the current creases. That is right
when the user asks for it and **wrong on load**: a file whose creases were edited
elsewhere would come back looking fresh, and the stale indicator would never
fire again for it.

Load rebuilds the *fold* and keeps the *saved* provenance. This is the one part
of the change that fails silently, and in the reassuring direction — everything
looks fine, staleness is simply dead. Worth a test that saves with known
provenance, mutates the document, loads, and asserts the window reports stale.

### The other difference: artifacts once, not per window

Refresh calls `refreshFoldArtifacts()` itself, which is correct for one window
and quadratic-feeling for twenty. Load computes fold artifacts once and slices
each window's fold from them.

### Format

Mirrors `textAnnotations` throughout: a field on the native project input, a
writer, a validator on read. `NATIVE_PROJECT_SCHEMA_VERSION` 4 → 5.

### Export loss

`.cp` and Oriedita export cannot carry these, so they need an entry in
`SUPERSET_FEATURES` or they are dropped with no warning — the same guard images
and rich text already sit behind.

## Deliberately not saved: the fold percentage

Where each window's fold had got to. Cheap to store (8 bytes) and genuinely
wanted, but the restore is the hard part and it is not worth blocking the rest.

**Storing the number is not storing the state.** `setFoldPercent` sets a uniform;
the solver keeps relaxing from wherever the mesh currently is. So the percentage
is a *target* and the mesh is a path-dependent result of it. There is no
randomness in either solver, so a load is reproducible — but it reproduces
"settle from flat to X", and in session your mesh at 60% may have arrived via
0 → 100 → 60. For most patterns those converge to the same equilibrium; for one
with a bistable region they need not.

**And settling twenty windows on open is not free.** Every window loads its model
whether focused or not (an unfocused one must still be able to redraw when the
camera resizes it), and the worker is single-threaded, so twenty settles
serialize. Preparation alone measured ~120 ms for a 14,641-vertex model; settle
is iterative on top. Plausibly seconds of a document that looks frozen.

Options considered, for whenever this is picked up:

| | size | open cost | honest about what it is |
| --- | --- | --- | --- |
| percentage + settle every window | 8 B | seconds, serialized | yes |
| percentage + settle on first focus | 8 B | none | yes, but windows open flat |
| **percentage + a thumbnail** | ~15 KB/window (WebP @256) | none | yes — a picture is a picture |
| the mesh | hundreds of KB | none | no; looks live, cannot resume |

The thumbnail is the interesting one: on open you need the *picture*, not the
simulation, and nobody interacts with nineteen of twenty windows in the first
second. ~305 KB for twenty, against ~10 MB for meshes, and it sidesteps the
resume problem because nobody expects to press play on a thumbnail.

Not doing any of it yet. The descriptor half stands alone and is worth having
first.

## Affected Areas

- `apps/web/src/lib/nativeProjectFile.ts` — input field, writer, validator,
  schema version.
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — include in the
  save snapshot; restore on load.
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — the load-time
  rehydration (resolve + `buildSegmentFold`), artifacts computed once.
- `apps/web/src/cp-workspace/inlineSimulation/inlineSimulationRuntime.ts` —
  populated from the load path rather than only from create/refresh.
- `apps/web/src/lib/supersetFeatures.ts` — export-loss entry.

## Checklist

### Phase 1 — Round-trip the descriptor

- [ ] Field on `NativeCreasePatternProjectInput`; write it; validate on read.
- [ ] Bump `NATIVE_PROJECT_SCHEMA_VERSION` to 5; confirm v1–v4 files still load
      (absent means `[]`, as `images` and `textAnnotations` do).
- [ ] Save path includes `oristudioCpInlineSimulations`.
- [ ] Test: save → load → identical descriptors.

### Phase 2 — Rebuild the folds on load

- [ ] Resolve each descriptor to a region and rebuild its fold into the runtime
      side table; fold artifacts computed once for the document.
- [ ] **Keep the saved provenance.** Do not recompute `sourceFingerprint`.
- [ ] Test: save, mutate the document externally, load → the window reports
      stale. This is the one that fails silently without it.
- [ ] A window whose region no longer resolves keeps its placement and says so,
      matching refresh's existing rule rather than re-pointing at the nearest
      region.
- [ ] Windows are cleared on document replace already; confirm load populates
      after that clear rather than racing it.

### Phase 3 — Don't lose them quietly

- [ ] `SUPERSET_FEATURES` entry so `.cp`/Oriedita export warns.
- [ ] Test: the export-loss warning counts open windows.

## Decisions and rejected alternatives

**Store the mesh.** Rejected on three grounds, any one sufficient: hundreds of KB
per window; it can contradict a document whose creases moved; and positions
without velocities cannot resume, so it looks like live state and is not.

**Migrate provenance on load** (recompute the fingerprint from the loaded
document). Tempting because it makes everything look consistent, and wrong: a
file can legitimately hold a stale window — fold, edit creases, save — and
recomputing erases exactly that. Fails in the direction where nothing looks
broken.

**Reuse `refreshOristudioCpInlineSimulation` verbatim for load.** It is the right
shape but does two things load must not: recomputes provenance (above) and
refetches artifacts per window.

**Persist `foldPercent` now.** Deferred, not rejected — see above. The descriptor
half does not depend on it, and the restore question deserves its own decision
rather than being settled by whatever is convenient here.

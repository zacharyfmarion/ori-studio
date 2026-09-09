# Pin Vertex Tool

## Goal

The exact solver has more than one valid answer for most detected patterns, and
it does not always converge on the one the user wants. Today the only lever is
editing topology and re-solving, which is indirect: the user knows *where a
particular junction belongs* and has no way to say so.

Give them one. **Pin a vertex and the solver holds it exactly where it is** —
`VertexParameterization::Fixed`, zero degrees of freedom, not a strong prior —
while everything around it re-equilibrates. This is verb 9 of
`crease-topology-repair.md`'s ranked list: "hold this one, solve the rest."

Concretely:

- A **Pin Vertex** tool. Click a vertex to pin it, click again to unpin. A
  pinned vertex draws in the warning hue and cannot be grabbed by Move Vertex.
- A **pencil dropdown on the solve chip**, right of Solve, arming Pin Vertex or
  Move Vertex without leaving the region.
- The same tool **on the rail**, next to Move Vertex, so it is reachable
  outside the detection flow and bindable to a key.
- **Pins go when the region goes** — Accept or delete clears the pins inside it.

## Approach

### The solver already has the mechanism, and it is one option away

`CandidateVertexMovementPolicy::Locked` already maps to
`VertexParameterization::Fixed` (`exact_solve.rs:1417`) — a vertex with no
parameters in the system, which no residual, no polish round and no snap can
move. Today only the four paper corners are `Locked`
(`candidate_graph.rs:1524`, `fold_exactize.rs:368`).

`ExactSolveOptionsWithExemptions` is the precedent for feeding the solver a set
of vertex ids from the browser: `exempt_vertex_ids` rides the options JSON,
`parse_exact_solve_request` validates it against the input and both bridges (the
wasm one and `apps/tauri/src-tauri/src/cp_detect.rs`) call that one function. A
sibling `pinned_vertex_ids` costs one field, one validation branch and no new
plumbing on either transport.

**Two Rust guards are needed, not one.** `Fixed` handles the optimizer; it does
not handle `normalized_input`, which dissolves collinear degree-2 vertices
before the solve and re-places them along the *solved* chord afterwards
(`place_dissolved_vertices`). A pinned degree-2 vertex would be dissolved and
then moved by its neighbours — silently, and detection splits creases at every
junction so degree-2 vertices are common in a region. So
`next_collinear_degree_two` must skip a pinned vertex.

The test that catches every other path is one assertion:
`solved.vertices_exact[pinned] == input.vertices[pinned].point`, **bit-exact**.

Note what pinning subsumes: the movement budget is measured from the input
coordinates, and a pinned vertex has zero movement by construction, so it can
never trip `movement_budget_exceeded`. (`exempt_vertex_ids` has no product
caller today for a related reason — the input is rebuilt from the live document,
so a hand-moved vertex already reads as zero drift.)

### Pins are positions, held for the session

A CP vertex is not an object — it is a coincidence of crease endpoints, and
kernel line ids are indices that an undo reshuffles. So a pin is stored as a
**model-space point**, and "which vertex is pinned" is answered by matching
against the current vertices within `VERTEX_COINCIDENCE` (the same ε the Move
Vertex preview and `vertex_endpoints_at` share) at read time.

That makes orphaning a non-event: a pin whose vertex no longer exists renders
nothing, blocks nothing and affects no solve — and an undo that brings the
vertex back makes the pin live again, which is the behaviour someone who undid
a mistake expects.

Storage is `oristudioCpPinnedVertices` on the crease-pattern slice, added to
`CP_DOCUMENT_SCOPED_KEYS` so opening another document cannot leave a stale pin
behind (that list is a total `Record`, so every producer is forced to say what
happens to it). Deliberately **not** persisted to `.osf` and **not** in the
history entry: a pin changes nothing in the document, and an undo after a pin
should walk back the last crease edit, not the marker.

### The tool: web-side commit, new input model

`CheckSuppressionRegionCreate` is the existing pattern for a rail tool whose
commit never reaches the kernel — `cpCommandCommitsWebSide` is the one predicate
both the commit and the preview path ask, precisely so a second web-side tool
cannot be wired into one and forgotten in the other. `VertexPin` is that second
member.

Input model is new: `pick-vertex`, a click on a vertex, with a `pickVertexTool`
engine (`down` resolves and commits; a miss starts nothing — no marquee
fallback, the rule Move Vertex already states). It is not `drag-vertex` reused:
that engine's contract is that a click in place does nothing, which is exactly
what this tool needs to *mean something*. Adding the mode is typecheck-forced
through `ToolInputMode` → `pointerRelease.ts`'s total `ALL_MODES` record, which
is how the exhaustive precedence tests stay honest.

The vertex hit test, the hover highlight and the "resolve to the vertex, not the
cursor" rule are all `vertexGrabAt`/`probeVertexGrab` already; the pick tool
reuses them unchanged and only takes a different cursor (`pointer`, not `grab` —
a press picks, it does not drag).

### Rendering

`cpPointsToScene` gains `pinnedIdx` and a pin colour beside the existing
`vertexIdx` grab-target set, resolved from `--status-warning` in
`cpPointStyle.ts`. Amber, not the accent: the accent is the grab-target
highlight and would collide, and per the hue rule the assignable crease colours
are fully spent — but a *vertex dot* is not crease ink, so a coloured dot reads
as state rather than as an assignment.

The pinned index set is derived once per `vertices` change from the canvas'
existing `vertexIndex`, not by scanning all vertices per pin per frame.

### The solve chip's dropdown

`SolveRegionChip` composes into `SuppressionRegionChip`'s `children` slot, which
renders before the controls — so a `MenuIconButton` with a pencil added to
`SolveAffordance` lands exactly where asked: right of Solve, left of the image
and checks menus. `useCpRegionChipDrag`'s `CONTROL_SELECTOR` already exempts
buttons and menu items from the bar drag, so nothing new is needed there.

Items arm a tool through `requestOristudioCpAction(operationId)` — the store
channel `useFoldedFigures` already uses for `CheckCamv` — and tick the one that
is active by reading `oristudioCpActiveToolId`. The list is data, so a third
tool later is one line.

Only shown on the solve chip, never on the base suppression chip: the base one
is what the rail tool makes, and pinning is a repair verb.

### Mapping a pin to a solver vertex id

`useCpRegionSolve` already exports the region's creases to FOLD and rebuilds the
input from it. Two facts make the mapping exact rather than heuristic:

- `FoldGraph::from_segments` interns endpoints into `vertices_coords` with the
  kernel's own coincidence rule, and `export_fold_document` writes document
  coordinates verbatim — no normalisation.
- `exact_solve_input_from_fold` numbers `CandidateVertex.id` as `0..n` over
  those same `vertices_coords`.

So a pin is matched straight against the exported FOLD's `vertices_coords` —
a sibling of the existing `foldEdgesVertices` reader — and the index it lands on
*is* the solver's vertex id. No tolerance to tune beyond the ε already shared
with the kernel, and an unmatched pin is simply not sent (a pin outside the
region, or on a vertex an edit removed).

### Clearing on exit

Accept and delete both remove the region; both drop the pins inside that
region's box (`boxContainsModelPoint`, the same containment `cpRegionPatternLines`
uses). Scoped to the box rather than "clear all", so a second region's pins and
any pin the user placed from the rail survive.

### A pin is a constraint on geometry, not a veto on the operation

Moving a crease with **one** end pinned moves the free end and leaves the pinned
one — the crease stretches and stays connected. With **both** ends pinned it does
not move at all. Copy is exempt: a copy makes new geometry, and new geometry
inherits no constraint.

This has to be enforced **inside the kernel op, before `append_and_split`** — not
by putting endpoints back afterwards. `move_selected_lines` deletes the selected
creases, transforms them, then re-splits them against everything they now cross
(`transform.rs:287`). A stretched crease crosses different creases than a
translated one, so a correction applied after the split would produce geometry
the splitter never saw.

The good news is that the whole family funnels through two functions:

| op | seam |
| --- | --- |
| `CreaseMove` (2-point) | `translate_segments` |
| `CreaseMove4p` | `transform_segments_by_points` |
| `CreaseCopy` / `CreaseCopy4p` | the same two — **deliberately not given the set** |
| `VertexMove` | `move_vertex`, which refuses a pinned source outright |

So the rule is one helper — `pinned.hold(before, after)` returns `before` when
`before` is within `VERTEX_COINCIDENCE` of a pin — applied per endpoint at two
sites. `mirror_selected_lines` (Reflect selection over line) needs nothing: it
*adds* mirrored creases and leaves the originals, so it is a copy.

The pinned set reaches the kernel **on the command payload**, not as session
state: these ops stay pure functions of their input, there is nothing new to keep
in sync or serialise, and `buildCpCommandPayload` is a single place to send it
from. With an empty set every op is byte-identical to today, so the Oriedita
parity oracle is untouched — the same opt-in shape `exempt_vertex_ids` already
has on the solver side. Worth a line in PORTING.md under native operations,
because it is a native constraint layered onto ported code.

**One hazard the research turned up.** `append_and_split` (`transform.rs:790`)
extends the model with no zero-length guard — unlike `insert_line_segments`,
which has one. A crease with one pinned end whose free end lands *on* that pin
collapses to zero length and enters the document as a sub-epsilon self-loop,
which per `cp-export-sliver-kills-fold` makes the Euler check discard every face
in the pattern. The pinned path must drop a collapsed segment explicitly, with a
test.

### The preview has to stretch too

`CreaseMove` previews by drawing the selection through one affine
(`updateTransformPreview` in the canvas), so without a matching rule the preview
would translate the crease rigidly and the commit would stretch it — the
preview/commit disagreement class that `vertexEndpoints.ts` exists to prevent.

It is cheap, because the channel already asks **per endpoint**:
`CpTransformPreview` has an `endpoints` set (that is how Move Vertex previews),
and both stroke adapters read `movesWhole || movedEnds?.has(k)` per end. Adding
a `heldEndpoints` set is one `&&` per end in `cpSnapshotToScene`,
`cpGeometryToScene` and `buildPoints`, and one line where the `move` object is
built. Copy's preview goes down a different path (`createSelectionGhost`) and is
untouched, which is the exemption falling out for free.

The mirror is already guarded: `creaseTransform.golden.test.ts` checks the
browser transform against points generated by
`crates/oristudio-cp/tests/transform_preview_golden.rs`. A pinned case goes in
the same fixture.

### Lengthen crease is refused, and it is a *topology* guard

Worth being precise, because it is not what it looks like: `lengthen_crease`
**never moves a vertex**. Both of its branches *append* a new crease running
outward from an existing endpoint — `add_extended_line_segment` calls
`add_line_segment_like_worker`, and `extend_to_intersection_point_2` returns
`add_segment.with_a(segment.b)`. The original crease is not touched.

So a pin is not violated by the movement rule here. What a lengthen *does* change
at a pinned vertex is its **topology**: a chain end becomes a pass-through, which
changes its degree, its Kawasaki fan, and whether the solver would have dissolved
it. Refusing it is the right reading of "nothing changes at a pinned vertex", and
it is what is implemented — but it is a different rule from the transform one and
the code should say so rather than implying the endpoint would have moved.

**All-or-nothing, refused before any mutation.** The candidates and the endpoint
each extension anchors on are both computable without touching the model — the
anchor is `original.determine_closest_endpoint(intersection)` in the
non-same-line branch and `line_to_extend.b` in the same-line one, and note those
are *opposite ends* of `add_segment`, so there is no uniform "`.a` is the anchor"
shortcut. A pre-pass over the candidates using the same helper the apply loop
uses is exact, and refusing up front avoids a half-applied lengthen.

The refusal travels as a **code, not a sentence**: a new `CommandError::Refused`
carrying `pinned_vertex`, mapped to `EngineError::new("pinned_vertex", …)` by the
existing `From<CommandError>` arm, and turned into a translated sentence by
`humanizeError` in `lib/toastMessages.ts` — which already toasts every workspace
error through `GlobalToasts`. That is how the share-link and worker codes work,
and it is the only way the message gets translated; a Rust `String` cannot be.

### What is out of scope

- **Rotate / scale / flip.** Not in the product — the operation frame is ported
  as far as *creating* a frame (`operation_frame_press/drag/release`); no frame
  transform operation exists. Whatever ports them later inherits the rule by
  going through the same two seams.
- **Delete and erase.** A pin holds a vertex where it is; it does not make its
  creases undeletable. Deleting the last crease at a pin leaves the pin inert,
  which the positional model already handles.

## Affected Areas

**Rust — the solver (`crates/oristudio-cp-compiler`)**
- `exact_solve.rs` — `pinned_vertex_ids` on `ExactSolveOptionsWithExemptions`;
  validation in `parse_exact_solve_request`; the set threaded into `SolveModel`
  (beside `exempt_vertex_ids`) and consulted at the `Fixed` branch; a pin guard
  in `next_collinear_degree_two`; tests.

Both bridges (`oristudio-cp-detect-wasm/src/lib.rs`,
`apps/tauri/src-tauri/src/cp_detect.rs`) go through the shared parse and need
only their error-code branch widened.

**Rust — the editor (`crates/oristudio-cp`)**
- `operations/native/vertex.rs` — the `PinnedPoints` helper (it already owns
  `VERTEX_COINCIDENCE`); `move_vertex` refuses a pinned source.
- `operations/transform.rs` — `translate_segments` and
  `transform_segments_by_points` hold pinned endpoints; the move ops pass the
  set, the copy ops do not; a collapsed-segment drop; `lengthen_crease` refuses
  up front when a candidate anchors on a pin.
- `lib.rs` — `CommandError::Refused { operation, code }`; `session.rs` maps it to
  an `EngineError` carrying that code.
- `lib.rs` — an optional `pinned_points` payload reader, wired for the three ops.
- `tests/transform_preview_golden.rs` + `tests/fixtures/cp/crease-transform-golden.json`
  — a pinned case.
- `PORTING.md` — the native-constraint note.

**Tool plumbing**
- `lib/oristudioCpCommands.ts` — `VertexPin` in the operation list (after
  `VertexMove`), its `ready()` command, `CP_WEB_SIDE_COMMIT_OPERATIONS`.
- `lib/oristudioCpActions.ts` — label/upstream override.
- `cp-workspace/tools/` — `pickVertexTool.ts` + test, `registry.ts`,
  `pointerRelease.ts`, `inputModelRegistry.ts`.
- `cp-workspace/cpCanvasCursor.ts` — the pick cursor.
- `toolCatalog/cpToolGlyph.tsx` — the `Pin` glyph.

**Surface**
- `CreasePatternWebglCanvas.tsx` — a `pick-vertex` press branch, the hover probe
  reused, the pinned set into `buildPoints`, and the pinned refusal in the
  `drag-vertex` press.
- `CreasePatternPanel.tsx` — `pick-vertex` in `webglActiveTool`, the web-side
  commit arm, the pinned-points prop. (Composition only; the verbs live in a
  `cp-workspace/pins/useCpVertexPins.ts` hook beside the concern.)
- `adapters/cpPointsToScene.ts`, `adapters/cpPointStyle.ts` — the pin colour.
- `adapters/cpSnapshotToScene.ts`, `adapters/cpGeometryToScene.ts` —
  `CpTransformPreview.heldEndpoints`, one condition per end in both.
- `tools/creaseTransform.ts` — the held rule in the preview mirror.
- `lib/oristudioCpCommands.ts` / the panel's `buildCpCommandPayload` — send
  `pinned_points` with the move and lengthen ops.
- `lib/toastMessages.ts` — the `pinned_vertex` sentence.

**Solve**
- `engine/cpExactSolve.ts` — `pinnedVertexIds` option → `stageOptionsJson`.
- `regions/regionSolveGeometry.ts` — `foldVerticesCoords` + the pin→id resolver.
- `regions/useCpRegionSolve.ts` — collect pins, pass them, clear on Accept.
- `regions/SolveRegionChip.tsx` — the pencil dropdown.
- `regions/useCpRegions.ts` / `CpRegionLayer.tsx` — clear on delete.

**Store**
- `store/workspaceStore/types.ts`, `slices/creasePatternSlice.ts`,
  `cpDocumentState.ts`.

**Cross-cutting**
- `i18n` — `npm run i18n:extract` for the new tool strings and menu labels.
- `analytics/events.ts` — `cp vertex pinned` (bucketed count only, never
  coordinates), and a `pinned_vertices_bucket` property on the solve event so we
  can tell whether pinning is used and whether it helps.

## Checklist

### Phase 1 — the solver holds a pin (Rust only, no UI)
- [ ] `pinned_vertex_ids` on `ExactSolveOptionsWithExemptions`, validated in
      `parse_exact_solve_request` with its own error message.
- [ ] Threaded into `SolveModel`; the `Fixed` branch consults it.
- [ ] `next_collinear_degree_two` refuses to dissolve a pinned vertex.
- [ ] Test: a pinned interior junction is **bit-identical** in `vertices_exact`.
- [ ] Test: a pinned *collinear degree-2* vertex is bit-identical while its
      neighbours move (the dissolution guard).
- [ ] Test: pinning a vertex the user dragged does not trip the movement budget.
- [ ] Test: an unknown id is refused, not ignored.
- [ ] Both bridges' error-code branch widened.

### Phase 2 — pins as state, and on screen
- [ ] `oristudioCpPinnedVertices` on the slice + `CP_DOCUMENT_SCOPED_KEYS`.
- [ ] `cp-workspace/pins/useCpVertexPins.ts` — toggle, clear-in-box, and the
      derived pinned-index set; unit-tested.
- [ ] `cpPointsToScene` `pinnedIdx` + pin colour; adapter test.
- [ ] Pinned dots render; verified in the browser.

### Phase 3 — the tool
- [ ] `pickVertexTool` engine + test.
- [ ] `VertexPin` command/action, rail placement next to Move Vertex,
      `pick-vertex` registry entry, `pointerRelease` mode.
- [ ] Canvas press branch + cursor; `drag-vertex` refuses a pinned vertex.
- [ ] Panel web-side commit arm; a panel test in the shape of
      `regionToolCommit.test.tsx` (both the commit *and* the preview early
      return — the preview one fails silently).
- [ ] `npm run i18n:extract`.

### Phase 4 — the solve window
- [ ] Pencil dropdown on `SolveRegionChip`, ticking the active tool.
- [ ] `foldVerticesCoords` + pin→solver-id resolution, unit-tested against a
      fixture FOLD.
- [ ] `pinnedVertexIds` through `runCpExactSolve` into both stage option strings.
- [ ] Pins inside the region cleared on Accept and on delete.
- [ ] Analytics event + solve property.

### Phase 5 — pins constrain transforms
- [ ] `PinnedPoints` + the hold rule at both kernel seams; move ops pass it,
      copy ops do not.
- [ ] Collapsed-segment drop in the pinned path (`append_and_split` has no
      zero-length guard, and a sub-epsilon self-loop discards every face).
- [ ] `move_vertex` refuses a pinned source.
- [ ] `lengthen_crease` refuses all-or-nothing when any candidate anchors on a
      pin; `CommandError::Refused` + the `pinned_vertex` sentence in
      `humanizeError`, so the toast is translated rather than a raw Rust string.
- [ ] Payload reader + `buildCpCommandPayload`.
- [ ] Rust tests: one end pinned stretches; both ends pinned is unchanged; copy
      ignores pins; a collapsed stretch is dropped; **an empty set is
      byte-identical to today** (the parity guard).
- [ ] `CpTransformPreview.heldEndpoints` in both stroke adapters and
      `buildPoints`; adapter tests.
- [ ] Wire it into `updateTransformPreview` and the vertex-drag preview.
- [ ] A pinned case in the transform golden fixture, so preview and commit
      cannot drift.
- [ ] PORTING.md note.

### Phase 6 — validation
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test --workspace`.
- [ ] `npm --workspace @treemaker/web run build:oristudio-cp-detect-wasm`
      (the kernel change does not reach the browser without it).
- [ ] `npm run lint:web`, `i18n:check`, `typecheck:web`, `test:web`.
- [ ] Browser: pin a junction in a detected region, solve, confirm the pinned
      dot did not move and the pattern around it did; Accept and confirm the pin
      is gone.
- [ ] Browser: select a crease with one pinned end, Move it, and confirm the
      preview stretches exactly where the commit lands.

# Repeat a range on the other side

## Goal

Repeat a contiguous suffix of Fold operations on corresponding paper across a
verified symmetry axis. Execute the operations sequentially, retaining their
material selections and layer choices. Save one numbered **Repeat** step by
default. The **Show as individual steps** switch is in setup, before execution;
it publishes the same recipe as ordinary editable operations instead.

Implementation: 2026-10-18, local only. No PR or push. External Heart and private
book files remain outside git and unchanged.

## Approach

### UX

1. Choose **Repeat on the other side…** from the Step inspector, step context
   menu, or Fold header menu. The current step ends the range. Starting at an
   earlier step creates a branch normally.
2. Choose the first source step in the range control or timeline. The source
   range is highlighted. Turn/rotation entries are included even though they
   do not have diagram numbers.
3. Choose a verified axis on the model immediately before the range. One axis
   is selected automatically; multiple axes need a choice. **Locate axis**
   uses the ordinary Locate line constructions and point/edge targets. A
   constructed line passes the same material/order checks as a suggestion.
4. Set **Show as individual steps**, off by default. No post-save Expand
   action. Changing only this switch preserves the prepared recipe and choices.
5. **Preview repeat** shows the folded result and CP in the ordinary Fold
   canvas. The document remains untouched. If another order is needed,
   **Choose layer order** opens the existing chooser; the range control and
   axis selector never open it automatically. Accepting the order resumes the
   remaining sequence. Cancellation leaves the document unchanged.
6. **Save repeat** publishes one Repeat node, or the same operations as
   individual nodes, in one Undo transaction. A failure shows its source
   operation, reason and last valid prefix; nothing partially commits.
7. A saved Repeat offers source navigation and **Update from source steps**.
   Updates are explicit, previewed and undoable, preserving the node's
   annotations and descendants. Parent drift breaks replay instead of silently
   changing the recipe. Changing notes alone does not invalidate it.

Spread layers remains in the sidebar, with its existing off default. Keyboard
commands go through the shared Fold shortcut runtime. No drawing-toolbar tool
or CP-only replacement screen is added.

### Sequential execution and ownership

The implementation lives in `apps/web/src/fold/repeat/`, running in the Fold
worker. It composes the **unchanged public Rust/WASM operations**; it does not
add a second folding or layer-order algorithm. A Rust Repeat primitive is not
needed for this document operation.

Preparation holds the source baseline and every source intermediate state.
For each operation it maps intrinsic sheet references, model-frame vectors and
axiom roots against the actual source and target parents, then calls ordinary
native replay. The next operation starts from that result. Selection scopes
such as `all` and `depth` become explicit corresponding material witnesses so
they cannot accidentally select the enlarged target stack.

The saved source landing/opening is part of the operation. Preparation first
replays that exact mapped choice. Native success is a unique result under
those choices; it does not enumerate unrelated outer/inserted landings. If
native replay reports unresolved completion, the existing order solver lists
bounded candidates, which are checked against the source intermediate result.
Inserted M/V queries use the public tuck validator with the same saved targets,
exactly as native M/V replay does. This does not reintroduce a Tuck UI tool.

Every intermediate result is checked by material-polygon intersections,
physical pose, exposed side, CP assignment/partial-mark deltas and relevant
layer relationships. Additional moved paper or CP changes refuse the repeat.
A symmetric silhouette alone is insufficient. Candidate search must be exact;
truncation is a refusal, never permission to assume a unique order.

The worker returns a frozen recipe containing the parent fingerprint,
source range/revision, original-sheet axis, ordinary operations and choices,
expected intermediate fingerprints and source-step IDs. Every fresh replay
executes the complete recipe and checks every intermediate fingerprint. The
final state alone is not authoritative.

The composite executor owns its internal native handles. Failed attempts,
unchosen candidates and canceled previews release their states. Retained
internal history participates in later **Unfold to step**, so all physical
creases survive. No transient native face IDs, handles or chooser indices are
serialized.

Individual mode appends the same prepared operations atomically. For source
`unfold-to` operations, local targets are rewritten to the corresponding newly
created document IDs and path guards. One Undo removes the entire append.
Grouped mode keeps these targets as local recipe indices.

### Implemented boundaries

This delivery verifies **global original-sheet reflections whose folded
baseline is also symmetric in material pose and layer order**. It accepts
horizontal, vertical and oblique axes, rotated/turned views, either starting
paper side, and differing flat precrease subdivisions. Local flap symmetry
requiring a piecewise material permutation is explicitly unavailable; manual
axis selection does not bypass that requirement. There is no guessed mapping
between coincident layers.

| Source operation | Current handling |
| --- | --- |
| Mountain/valley, outer or inserted | Map line, exact participating material, moving side, saved targets and completion; native replay. |
| Full/segment/pinch precrease | Map line and finite extent, retain remembered direction; native replay. |
| Unfold/refold along a crease | Map the crease and actual material selection. |
| Inside/outside reverse, crimp | Map hinges, seed, opening and completion. |
| Squash, petal, rabbit ear, swivel variants | Map their anchors, vectors, sectors, constructed lines and choices. |
| Open/closed sink, unsink | Map line, tip selection and saved pocket. |
| Turn/rotate | Map the view change; an unrepresentable oblique turn-over is refused. |
| Unfold to step | Support a target inside the selected range or its baseline. Earlier external targets require a wider range. |
| Linked Collapse | Explicitly unsupported: a whole-sheet snapshot cannot overwrite the first side. |
| A Repeat used as a source operation | Explicitly unsupported by the authoring adapter. The reader/executor bounds nested recipes, but authoring does not invent a correspondence for them. |

All adapters remain subject to the native guards and intermediate verification.
This is not a claim that every model using a listed operation is repeatable.
Limits: 128 source operations, 512 baseline faces, 2,400 CP segments in a
comparison, 64 exact completion candidates. Reader/executor also bound recipe
nesting and total operation count.

Grouped playback currently crossfades the endpoints, as other non-animated
operations do; it does not invent a single hinge motion. An internal scrubber
and animation of each internal fold are deferred. Individual mode exposes
ordinary playback for each operation. Final Fold/CP rendering, numbered
cards, Diagram links and exports use the existing state-based paths.

### Serialization, source drift and UI races

Repeat is an additive operation in the existing sequence format. Strict readers
reuse ordinary operation/choice validation for all entries; malformed or unknown
nested operations lock the outer node and preserve raw data. Existing designs
need no migration. The legacy landing normalizer traverses recipes too.

Explicit update uses compare-and-swap on the old recipe. Source path digests
exclude annotations. Preparation and commit check document load, sequence,
parent path/fingerprint and source range; stale async responses are discarded.
Range/axis changes invalidate pending choices. A representation-only change
retains them. The native operations remain the final geometry/order gate.

### Validation

Synthetic public tests cover sequential precrease and folding, existing-crease
references, inserted valley, inside reverse, partial marks, oblique symmetry,
both paper sides and rotated/turned views. Independent opposite-side folds
check intermediate fingerprints. Tests also cover incompatible hidden order,
crossing the destination, parent drift, failing intermediate fingerprints,
state cleanup, saved-file round trips, local historical targets, expanded
history remapping, malformed/nested payloads and atomic document updates.

An ignored copy of the external Heart was replayed in a fresh isolated browser
context. Its single front-flap mountain insertion was repeated through native
operations. The final CP adds the intended two bottom-corner creases without
central/hidden-layer creases; the original file was not changed. Browser checks
also exercise grouped versus individual saving and one-transaction Undo.

Final local validation:

- 551 tests passed across 79 relevant files: Repeat, document, sequence,
  animation, native-engine bridge, placement preview, actions, analytics and
  affected CSS checks. The 23 Repeat-specific tests include native replay,
  transactions and file handling. Both native completion-refusal envelopes
  resume through the existing order solver.
- Changed TypeScript/TSX files pass ESLint. Full TypeScript checking,
  production Vite build and the landing prerender pass. Translation checks
  pass for all supported locales.
- Isolated browser checks pass for manual axis construction, timeline range
  highlighting, grouped/individual equivalence, one-transaction Undo,
  cancellation and explicit update with unchanged source. The external Heart
  copy's single-front-flap insertion also repeats successfully.
- `git diff --check` passes. No private models, screenshots or generated WASM
  are included in the change. Local browser probes and screenshots are ignored
  artifacts; they do not modify the user's open project.

The full web suite was not rerun. An earlier broader store check encountered
three existing expectations in `foldSlice.test.ts` for the old spread default
and an old format version; these were left unchanged. The new Repeat store
tests pass. Rust and WASM source are unchanged, so no native rebuild,
workspace Rust run, Tauri build or independent oracle run was needed. Native
behavior was exercised through the existing public WASM bridge. The web build
skipped unchanged native prehooks and ran the landing prerender explicitly.

Local testing: `http://localhost:5328/fold`, served by this worktree. Use the
Step sidebar's **Repeat on the other side…**, choose the first source step and
axis, then preview and save. The individual-step switch is available before
preview/save; a saved Repeat remains a single step.

## Affected Areas

- `fold/repeat/`: verified symmetry, reference mapping, intermediate validation,
  preparation, composite replay, setup hooks and refusal messages.
- `fold/document/`: Repeat schema, strict reader/writer, legacy normalization,
  atomic individual append, local history remapping and explicit update.
- `fold/engine/` and `workers/foldSequenceWorker.ts`: worker preparation calls,
  composite handle ownership and history-aware replay.
- `components/fold/repeat/`: setup, axis construction, order chooser and saved
  source controls, using adjacent CSS modules and existing UI primitives.
- Fold action catalog, menu dispatch, timeline range selection/highlighting,
  pending-state rendering, captions and playback fallback.
- Fold store transaction surface, central analytics and locale catalogs.

## Checklist

- [x] Record range-based UX, sequential execution and one-step default.
- [x] Put the individual-step switch in setup and retain the prepared recipe.
- [x] Prove material symmetry and sequential replay on public tests and a Heart copy.
- [x] Implement input/choice adapters with explicit unsupported cases.
- [x] Preserve saved landing choices and verify intermediate material/CP/order.
- [x] Add frozen composite recipes, strict serialization and fresh replay.
- [x] Add atomic individual-step append and local-history remapping.
- [x] Add worker preparation, extra-order decisions, cancellation and handle ownership.
- [x] Add range/axis setup, preview, confirmation and shared order chooser.
- [x] Add source navigation, source-change notice and explicit update/rebuild.
- [x] Integrate Unfold to step, numbered presentation, exports and analytics.
- [x] Verify grouped/individual equivalence and single-transaction Undo in the browser.
- [x] Finish translations, lint/typecheck, relevant tests and production build.
- [x] Finish browser audit of manual axis selection and timeline range changes.
- [x] Record delivered boundaries and local testing entry point for handoff.

### Diagram callouts

Imported Repeat instructions receive a native editable callout. Compare the
parent and landed material polygons to locate the target in the starting pose;
precrease-only ranges use their new physical crease spans. Reflect that material
back to the source to name the screen direction after the Diagram's rotation or
turn-over. Place the label outside the paper and its leader on affected material.
Keep the existing imported-mark refresh, editing, spread, save/open and export
paths. No change to fold execution, saved recipes or file format.

- [x] Derive affected material and generate localized directional callouts.
- [x] Verify range/precrease, rotated/back poses, native annotation persistence.
- [x] Inspect the private Heart example in an isolated browser; finish checks.

Validation: 176 tests across Diagram/Fold, Repeat, annotation carry, imported
marks and Fold-linked document persistence passed, along with TypeScript,
changed-file ESLint, i18n checks and `git diff --check`. An isolated bundled
Chromium session imported Heart's last Repeat from an ignored private copy:
the callout says “Repeat on the right” and points into its upper-right flap.
Turning it updates untouched wording and box placement; editing its text then
turning keeps the author's text. Diagram serialization retains the callout.
No engine, WASM, stylesheet or bundling changes; native rebuild and production
build were not needed. Existing captured diagrams need the step reimported to
receive the new instruction mark.

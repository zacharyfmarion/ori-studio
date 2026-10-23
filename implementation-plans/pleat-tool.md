# Pleat tool

## Goal

Add a flat Pleat tool: locate the mountain line, then the valley line on the
starting model, select the flap, and confirm one numbered, editable Pleat step.
Verify the current Heart using a private copy, without changing the original.

## Approach

- Compose the existing public plain-fold operations sequentially.
  Transport the valley line with the paper after the mountain fold. Preserve
  the selected material; refuse a second fold that drags unrelated paper.
  The second operation is a mountain in the intermediate, turned-over flap's
  view, producing the requested valley on the starting model.
- Use the existing line picking, snapping, layer selection and explicit order
  review. Enumerate valid pairs through the native placement solver, deduplicate
  identical final states, and save both choices for deterministic fresh replay.
- Keep intermediate states for Unfold to step and release them with the final
  state. Failed or canceled operations never partially modify the document.
- Add strict file handling, captions, icon, analytics and Repeat mapping.
- Support parallel and angled straight pleats through the same native operations.
  Connected paper outside the selected flap remains protected by native guards.

## Affected Areas

Fold document/engine adapters, line tools and shared tool window, native-engine
integration tests, localization, analytics, and ignored Heart audit artifacts.
No ported solver changes. The follow-up below replaces the conservative image-overlap cutoff with validation by the existing full arrangement; material topology guards stay unchanged.

## Checklist

- [x] Inspect current Heart and existing plain/compound fold interfaces.
- [x] Add sequential Pleat execution and exact placement-choice enumeration.
- [x] Add two-line authoring, flap selection, confirmation and order review.
- [x] Add serialization, presentation, Repeat and Unfold integration.
- [x] Verify synthetic cases and the current Heart through fresh replay.
- [x] Run relevant checks and verify in the browser.

## Delivered behavior

The Pleat icon sits beside Crimp. Its initial construction is two free lines,
with the existing point-snap switch available: mountain first, valley second.
Both lines support all seven axioms, Free line and Existing crease, chosen on
the starting pose. Toolbar changes follow the active line; once the mountain
line is located, changing the valley construction keeps the mountain picks
and its selected root. The two fields in the tool window edit their named lines.
The drawn valley segment identifies the default visible flap. The layer
selector and Swap remain available before confirmation; multiple valid final
orders use the normal explicit order review after confirmation.

One saved Pleat retains both native placement choices, without transient face
IDs. Older sequences require no migration. New pleats replay from their two
operations, and retain internal history for Unfold to step. Repeat maps both
lines and choices; an opposite-facing correspondence is explicitly refused
because this tool currently specifies mountain first only. Grouped animation
crossfades endpoints instead of showing a misleading single-hinge rotation.

Search is exact within bounded native enumeration: at most 64 orders per leg
and 256 order pairs. An exhausted search refuses explicitly instead of hiding
additional orders. Native connectivity and layer-order guards are unchanged.

## Initial validation (before the follow-up)

- The Fold suites covered 1,233 tests across 168 files. A stale phone-menu
  expectation from the accompanying Repeat change was corrected; the final
  focused rerun passed all 21 tests across the header and three Pleat files.
  The remaining 1,232 tests passed in the broader run. Node 26's experimental
  Web Storage was disabled for the jsdom run to preserve its localStorage.
- Native WASM tests cover mountain/valley assignment, angled pleats,
  precreased paper on both sides, saved-choice replay, refusal cleanup,
  Unfold-to history and mirrored Repeat with both decisions retained.
- TypeScript, full web lint (one existing React Compiler warning in
  StepFilmstrip), all locale checks, production Vite build and explicit landing
  prerender passed. The build reused current generated WASM; no Rust, WASM
  bridge or Tauri sources changed, so no native rebuild/oracle run was needed.
- In an isolated browser, opened an ignored copy of the current external
  Heart and used actual toolbar/canvas clicks to draw both lines and confirm.
  The small central flap was selected by default and produced one valid order.
  The CP gained only the two local pleat lines. Saved as diagram step 28, then
  reopened in a fresh browser; its final folded-state fingerprint matched
  exactly. The user's original file and open project were untouched.
- Private replay files, browser scripts and screenshots remain under ignored
  `artifacts/pleat/` or `/tmp`; no private model or book image is tracked.

Local testing: `http://localhost:5328/fold`. Private review copy:
`artifacts/pleat/heart-with-pleat.osf` (step 28). Ready for user audit.

## Follow-up: exact angled pleats and independent line construction

The previous “Make valley line parallel” correction was rejected by the user
and has been removed. Slightly angled pleats must preserve their drawn lines.

The native image guard used MIN_FEATURE (0.1% of the sheet) as an unconditional
cutoff for new narrow overlaps. This is not a physical constraint: overlapping
existing faces does not create a thin piece of material. It rejected the return
fold on both Heart and an independent three-layer strip. The intermediate
refusal also named flaps in the wrong state, producing “Include flap 2” when
that flap was already selected.

The existing `ConstraintProblem` already compares pair overlap, overlay cells,
folded hinges and constraints at TOL. Narrow overlaps now pass through that
complete arrangement check. Ambiguities remain refusals; completion and the
final state gate still require all pair relations, transitivity, noninterleaving
constraints, letters, connectivity and geometric consistency. Near-miss,
short-crease and minimum-material-piece thresholds are unchanged. No line is
adjusted to obtain a result. The behavior version is 8, invalidating old caches.

- [x] Admit structurally resolved narrow image overlaps for plain and compound
  folds; retain actual geometry and order refusals.
- [x] Remove the parallel-line correction and its translations.
- [x] Stop presenting intermediate-state flap IDs as original-state fixes.
- [x] Support every Locate line construction for the valley; preserve completed
  mountain picks and root when changing the active construction.
- [x] Query and cycle each line's axiom roots independently. Store `secondRoot`
  with its axiom; recompute and match it on replay; refuse a stale/missing root.
- [x] Serialize both constructions and map the second root during Repeat.
  Existing free/crease pleats read unchanged; no model migration is needed.
- [x] Verify native ordering, missing-pair refusal, unchanged tilted inputs,
  UI authoring, root preservation, file replay and mirrored Repeat.
- [x] Verify the Heart in isolated bundled Chromium, never personal Chrome.

The ignored audit copy is `artifacts/pleat/heart-angled-pleat.osf`, diagram
step 28. The actual UI preserved the mountain's Axiom 1 while the toolbar
switched the valley to Axiom 2 and back to Free line. The selected small flap
folded with the slightly tilted valley unchanged. Reopening in a fresh browser
produced exactly the same fingerprint, `fs1:4ccf1f6334e34ad2`. The CP adds the
local pleat lines only. A separate browser check verified all nine options in
the actual valley dropdown and the toolbar's active-line highlight. The user's
original Heart and personal browser were untouched. Ready for user audit.

Validation for this follow-up:

- Native Fold, layer-order and Fold bridge suites passed. Obsolete
  tests requiring every narrow overlap to fail were replaced by exact-input
  landing/replay assertions. Plain and reverse regressions remove a narrow
  overlap's required pair and verify that the full gate rejects the result.
- The full Fold web run covered 168 files (1,245 passed initially; one old
  blanket-sliver expectation needed updating). The updated expectations and
  new authoring/replay tests passed in focused reruns (90 tests, followed by
  the three canvas-flow tests including independent cycling of both roots).
- Rebuilt the Fold WASM bridge; typecheck, web lint, locale checks, Rust format,
  targeted Clippy, production Vite build and explicit landing prerender passed.
  Existing warnings: StepFilmstrip React Compiler compatibility, a configured
  Clippy lint unavailable in this toolchain, and bundle-size advisories.
- Unrelated Rust workspace crates, other port oracles and desktop checks were
  not rerun: no ported algorithm, Tauri surface or unrelated engine changed.
  Web build reused the freshly rebuilt Fold WASM and current other artifacts;
  its postbuild prerender ran explicitly after skipping rebuild lifecycle hooks.

## Diagram import marks

The diagram capture previously saw no action for a composite Pleat. Preserve
its original input for saved-step queries, and describe both creases on the
starting pose, with each line's own mountain/valley assignment. Clip the
valley line to the selected material using the starting scene's overlap cells
and retain hidden-line visibility. Use the existing editable pleat-arrow
annotation, normal to the aligned average of the two line normals and directed
from mountain to valley at the flap. No folding or file-format changes.

- [x] Expose complete pleat action marks for preview and saved-step capture.
- [x] Import both line assignments and a correctly oriented pleat arrow.
- [x] Verify angled/rotated cases, refresh and file round trips, and the private Heart copy.
- [x] Run focused tests, lint, typecheck, and isolated browser verification.

Validation: 126 tests across 17 focused suites passed, including native-WASM
Pleat/repeat execution, diagram capture after fresh replay, refresh, spread,
annotation serialization, and rotated/back-side marks. Typecheck and changed-file
ESLint passed. An isolated browser imported the private Heart step and showed
both crease styles and the local downward pleat arrow; all three are editable
annotations. The original Heart was untouched. No Rust/WASM binary or file
schema changed, so no native rebuild or format migration was needed. Existing
imported pictures remain snapshots; reimport the step to receive these marks.

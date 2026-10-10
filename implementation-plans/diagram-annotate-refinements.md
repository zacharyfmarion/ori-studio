# Diagram annotation refinements

## Goal

Credit DEFOX and Kei Morisue, and make annotation drawing, shortcuts, and
equal-angle controls match the requested editing workflow.

## Approach

Use the existing shared shortcut runtime and annotation controls. Keep focus on
the canvas after drawing numeric annotations. Offer circular drawing from bounding
corners or the center, including areas outside the paper. Preserve existing saved diagrams.
Preserve selection after drawing, including the bisector line. Expose equal-angle
visibility and radius when its separate indicator is selected, and
update the native SVG X-ray glyph.

## Affected Areas

- README and in-app acknowledgements; Spread controls.
- Annotate gestures, keyboard bindings, tool glyphs, and inspector controls.
- Annotation model, persistence, shared rendering, translations, and tests.

## Checklist

- [x] Add DEFOX acknowledgements and Affine credit link.
- [x] Bind Space to Line and T to Text in Annotate.
- [x] Remove automatic numeric-field focus and verify Escape across tools.
- [x] Use bounding-corner circular drawing and allow off-paper regions.
- [x] Improve the X-ray glyph.
- [x] Add equal-angle radius and visibility options.
- [x] Validate behavior, translations, and browser presentation.
- [x] Update the existing PR and hand off the local preview.

## Validation

- Web lint, typecheck and i18n check pass.
- Full web suite: 916 files, 12,695 tests pass; existing 2-file/13-test skips.
  The subsequently added empty-enlargement regression also passes in the
  20-test zoom capture suite.
- Normal `npm run build:web` passes, including all generated wasm and landing
  prerender hooks.
- Chromium checks Space/T, off-paper X-ray bounds, focus after X-ray and equal
  divisions, Escape, unchanged bisector-line selection, manually selected
  indicator radius/visibility, and the DEFOX credit. Both control screenshots
  were inspected. Evidence: ignored `artifacts/diagram-annotate-refinements/`.
- Rust/native shell tests were not repeated: this change only edits shared
  frontend code, translations and docs; the normal build still rebuilds wasm.

## Behavior notes

- Selection after drawing is unchanged, including the bisector line. The
  separate equal-angle mark is selected manually to edit its options.
- Text and callout creation still focuses the text editor intentionally;
  Escape leaves that editor and returns to Select. Numeric fields do not take
  focus after drawing.
- Existing circles without a stored radius and equal-angle marks without the
  new options retain their original appearance. Sized circles share their
  actual radius with drawing, picking, arrow landings and label clearance.

## Handoff

Changes are on `claude/diagram-workspace-plan-ceb4f2`, in
[PR #436](https://github.com/zacharyfmarion/ori-studio/pull/436).
The worktree’s persistent preview is running at <http://localhost:5291/diagram>.

## Tool parameter and credit follow-up

The hint window owns creation defaults, through a store-free parameter catalog
and small control components. Layers continues to own selected-object properties.
Circle drawing offers Bounds (default) and Center, shared across Circle, Close-Up,
Enlarge and X-Ray. Each gesture snapshots its chosen mode; both allow empty areas.
The Affine credit opens an interactive popover with a visible DEFOX link.

- [x] Move all creation options off the rail and into the hint window.
- [x] Add persisted circle drawing modes and matching instructions.
- [x] Make the DEFOX credit clickable, order acknowledgements, and replace the X-Ray glyph.
- [x] Validate UI, gesture behavior and translations; track deployment on the existing PR.

Follow-up validation: web lint, typecheck, i18n and normal production build
(including wasm generation and landing prerender) pass. The full web suite
passes 917 files / 12,703 tests. The new credit-popover regression passes
separately. Two font metric tests initially skipped because both the old local
macOS and canonical Linux assets were present; the unused build outputs were
archived, and the annotation-model suite rerun against the canonical set.
Chromium verifies both drawing modes, unchanged marks/selection, creation
options in the hint only, and native link activation plus keyboard dismissal.
Final CI and immutable/branch preview verification are reported on PR #436.

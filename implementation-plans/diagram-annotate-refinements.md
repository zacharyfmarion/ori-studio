# Diagram annotation refinements

## Goal

Credit DEFOX and Kei Morisue, and make annotation drawing, shortcuts, and
equal-angle controls match the requested editing workflow.

## Approach

Use the existing shared shortcut runtime and annotation controls. Keep focus on
the canvas after drawing numeric annotations. Draw circular areas from bounding
corners, including areas outside the paper. Preserve existing saved diagrams.
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
- [ ] Update the existing PR and hand off the local preview.

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

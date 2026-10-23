# Fold and unfold as a tool option

## Goal

Offer two plain fold tools, Mountain and Valley, with a **Fold and unfold**
switch instead of a separate Precrease tool. Preserve saved designs.

## Approach

Keep the tool direction separate from the optional return to the starting
pose. The switch is available before and during preview, stays selected across
Mountain/Valley and successive folds, and preserves the current line and layer
selection. When enabled, show Whole line / Segment / Pinch and use the existing
public `precrease` operation with the selected direction. When disabled, use
the ordinary fold operation. Other tool families ignore the option.

Remove the separate Precrease entry from the rail, phone picker, kind controls,
menus and shortcut catalog. Refusal fixes that request a precrease select a
direction and enable the option. Saved operation semantics stay unchanged;
verify the existing native library by fresh replay and hashes before deciding
whether any migration is needed.

## Affected Areas

- Fold tool catalog/state, preview builder, extent controls and refusal fixes.
- Tool window, shared menu/action catalogs and keyboard registry.
- Analytics, translations, affected UI/state/WASM tests.
- Read-only verification of the existing model library.

## Checklist

- [x] Separate plain tool direction from fold-and-unfold mode.
- [x] Add the shared switch and preserve extent/selection behavior.
- [x] Remove the separate tool from all entry points.
- [x] Verify direction, ordinary folding, partial precreases and saved replay.
- [x] Verify the browser, translations, lint/typecheck and relevant tests.
- [x] Record whether migration was necessary; preserve existing models.

## Validation

- 156 relevant Fold, component, menu and command test files: 1,202 tests pass.
  Covers both precrease directions, toggling in preview, retained picks/layers,
  Segment and Pinch, refusal fixes, and example flows through the public WASM engine.
- TypeScript passes. Web lint passes with one existing TanStack Virtual warning
  in `StepFilmstrip.tsx`. Translation extraction, all eight target locales,
  stamping and `i18n:check` pass.
- Browser check at `http://localhost:5327/fold`: only Mountain and Valley in the
  plain-fold controls; the switch survives a direction change and commit.
  Toggling during preview changes between Mountain fold and Mountain fold and
  unfold without picking the line again. Committing leaves the sheet flat with
  a remembered mountain crease. Screenshot: `artifacts/fold-and-unfold/browser.png`.
- Fresh engine replay: 38 completed/in-progress files, 570 steps, no failures.
  The existing return audit also passed 1,102 parent/sheet returns.
- All 73 native model files retain their original hashes. **No migration is
  needed:** saved `precrease` operations and their directions are unchanged;
  only the transient authoring controls changed. Archived and excluded designs
  remain untouched as well.
- No Rust, WASM bindings, routing or bundling changed; no engine rebuild,
  Rust suite or production build was needed. Tests used the existing built
  engine artifacts. Validation logs are under `artifacts/fold-and-unfold/`.

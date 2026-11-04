# Fold crease-pattern front/back viewing

## Goal

Let the user view the Fold workspace's crease pattern from the back while
preserving its existing background, theme colors, line styles and widths.
Paper colors and paper pens do not affect the crease-pattern pane.

## Approach

Keep the viewing side as local UI state, independent of the folding sequence's
Turn over step and starting side. Mirror the shared PaperPane's model-to-screen
transform around the sheet's horizontal midpoint so rendering, picking and
overlays agree. Reverse viewed mountain/valley assignments before passing the
lines through Edit's existing cpPatternStrokes renderer; auxiliary lines and
borders retain their roles, and step instructions retain their solid, double-width
strokes. No document geometry or fold assignment changes.

Use the existing white front / grey back face icons and labels naming the side
the action will show. Expose the control in the desktop toolbar and phone overflow
menu, with an enum-only analytics event. Keep Diagram as the default paper style
and preserve the original model Turn over icons.

## Affected Areas

- Fold canvas viewing transform and stroke hook.
- Shared PaperPane composition, viewport toolbar and side icons.
- Localization, Paper help text and central analytics.
- Camera/picking, line-style, toolbar and document-immutability regression tests.

## Checklist

- [x] Integrate current main's shared PaperPane and spread renderer.
- [x] Remove crease-pattern paper fills and paper-pen overrides.
- [x] Preserve Edit's renderer settings and reverse only viewed M/V assignments.
- [x] Retain horizontal turnover, accessible labels, phone access and analytics.
- [x] Update regression coverage for unchanged ink/width, no fill and mirrored picking.
- [ ] Run lint, typecheck, i18n and web unit validation.
- [ ] Verify front/back rendering in the browser and leave the preview running.
- [ ] Update PR #558 with the narrowed scope and verify merge readiness.

PR: https://github.com/zacharyfmarion/ori-studio/pull/558.

The local dependency rebuild covers the simulator and all generated WASM bridges
before web validation. No engine, file-format or desktop-shell code is changed
by this feature; native/oracle checks and production bundling are covered by CI.

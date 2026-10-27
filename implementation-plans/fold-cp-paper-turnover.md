# Fold crease-pattern paper colors and turnover

## Goal

Draw the Fold workspace's crease-pattern sheet in its paper style's front/back
colors and let the user turn it over left to right to inspect the back, with
mountain and valley creases reversed. Use the paper’s pens throughout, start
new Fold sequences in Diagram, and retain the original paper-and-arrow icons
for the model-turn actions in Fold and Diagram.

## Approach

Use the renderer's existing sheet-fill channel beneath the crease strokes.
Keep the CP side as view state, independent of the folding sequence's Turn over
step and starting side. Mirror the pane's model-to-screen transform about the
sheet's horizontal midpoint so picking, hover and tool overlays stay aligned.
Reverse M/V appearance for both ordinary and instruction creases, using the
paper style's pens for all creases. Show the current side with a white front
or grey back paper-face icon, and label the action with the side it will show.
Compose the existing viewport toolbar control on desktop and its overflow menu on phones; record an enum-only analytics event.

## Affected Areas

- `apps/web/src/fold/canvas/`: CP paper geometry, side, and stroke appearance.
- `apps/web/src/components/fold/canvas/`: pane rendering and toolbar wiring.
- Fold Paper help text, localization, and central analytics.
- Focused rendering, interaction and toolbar regression tests.

## Checklist

- [x] Inspect repository guidance, paper rendering, camera/picking and toolbar patterns.
- [x] Bootstrap this worktree and create a feature branch.
- [x] Implement sheet colors, horizontal turnover, and reversed M/V presentation.
- [x] Add toolbar access, help text, localization and analytics.
- [x] Test asymmetric sheets, reverse creases, picking/overlays, and repeat turnover.
- [x] Run web lint, typecheck, unit tests, i18n checks and browser verification.
- [x] Open a draft PR against main and leave a local testing server running.

- [x] Apply the paper pens to every CP crease, including step instructions.
- [x] Replace turnover arrows with front/back paper-face icons and descriptive labels.
- [x] Validate the follow-up and update the draft PR.
- [x] Restore the original turnover action icons in Fold and Diagram after visual review.
- [x] Verify Default’s crease categories and report why its pens differ.
- [x] Keep Diagram as the starting style for new Fold sequences, preserving saved style choices.
- [x] Validate the turnover-symbol and starting-style updates for the existing draft PR.

Draft PR: https://github.com/zacharyfmarion/ori-studio/pull/544.

Browser verification in Chromium covered custom front/back colors on the
pleat-in-eighths fixture, reversed M/V appearance, return to front without a
document change, and back-side snapping (the displayed upper-left corner
selects sheet point `[1, 1]`). Light and dark themes and the touch-phone
overflow menu were inspected, with no page errors. Screenshots are under the
ignored `artifacts/fold-cp-*.png` paths. The server is at
`http://localhost:5371`, started with `scripts/dev-server.sh`.

Validation passed: web lint, web typecheck, i18n check, `git diff --check`,
and the complete web unit suite (1,260 passing files; 16,154 passing tests,
one expected failure and 21 skipped tests). New coverage checks polygon
fills, back-side camera/pointer coordinates, M/V inks and dash patterns,
instruction creases, desktop and phone controls, unchanged sequence data,
and the enum-only analytics event.

The worktree bootstrap copied stale generated dependencies, so the full
`npm run typecheck:web` prehook rebuilt the simulator and every WASM bridge
before validation. Node 26's native `localStorage` shadows jsdom's storage;
the unit suite runs with `NODE_OPTIONS=--no-experimental-webstorage` (the
repository's CI uses Node 22). No source workaround was needed.

Rust workspace/oracle tests and native desktop checks are out of scope: this
change is shared frontend presentation and view state, with no engine,
file-format or shell changes. Production bundling is unchanged, so a web
production build is unnecessary.

The paper-pen and icon follow-up uses the shared paper painter for crease
colors, point widths, centered dashes, and auxiliary visibility, independent
of Edit's viewport styling. Instructions use the diagram-crease pens, and
viewing the back exchanges the complete M/V pens. The icon shows the current
side (white front, grey back); its label names the side the action will show.
Translations and paper help text match both controls.

Follow-up validation passed: web lint, typecheck (using the already rebuilt
WASM dependencies), i18n check, and 303 tests in 44 files covering the Fold
canvas, camera, tools, and CP imports. Browser checks covered custom pen
widths/dashes and paper colors, turnover without changing sequence data,
light/dark themes, and the phone overflow control, with no page errors.
Screenshots are in `artifacts/fold-cp-pens-*.png`. The complete web suite above
was run for the initial implementation; the follow-up uses focused coverage
because it changes only Fold presentation. The same native/build exclusions
apply.

The model-turn actions in Fold and Diagram use their original paper-and-arrow
icon (`RotateCcwSquare`), restored after the user reviewed the looped-arrow
replacement. This covers Fold’s rail and menus, Diagram’s card shortcuts,
action menus, and pose controls. Diagram’s annotation symbol stays unchanged;
the CP viewing-side control retains its white/grey faces.

New Fold sequences snapshot the built-in Diagram preset. Saved style choices,
including Default, are preserved. Default’s red/blue crease colors are
intentional: folded creases keep their M/V pens, current instructions use
the diagram-crease pens, and flat/unfolded creases use the auxiliary pen.
The user explicitly chose to keep that distinction.

Final validation after the turnover-symbol and Default-style changes passed:
web lint, typecheck, `git diff --check`, and the full web suite (1,260 passing
files, 16,153 passing tests, one expected failure and 21 skipped tests).
Chromium verified the looped arrow in Fold’s rail and Diagram’s empty-step
shortcut, both turnover actions, Default on a fresh Fold sheet, and keeping
an explicitly selected Diagram style across a turn. No page errors. No new
translation strings, engine changes, or production build changes were added;
the native/oracle/build exclusions above still apply.

The action-icon reversion passed web lint, typecheck, `git diff --check`, and
592 focused tests across 38 files. Chromium verified the restored Fold rail
and Diagram empty-step icons, with no page errors. This removes the extracted
looped-arrow component and restores the existing glyph assertion; no new tests
are needed for the icon-only reversion. Paper colors, pens, viewing-side
controls, Default starting style, and the merged Diagram import controls are
preserved. The same native/oracle/build exclusions apply.

Diagram is restored as the starting paper style following the user's updated
preference. Existing Default and custom style choices remain unchanged. The
existing creation, editing, file round-trip, and Paper pane tests now verify
the restored default and white/grey swatches. Web lint, typecheck,
`git diff --check`, and 271 focused tests in 29 files pass. Chromium confirms
Diagram on a fresh Fold sequence with no page errors. No new tests or
translation changes are needed; the native/oracle/build exclusions above
still apply.

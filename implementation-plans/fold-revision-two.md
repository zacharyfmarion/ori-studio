# Fold revision two

## Goal

Apply the Revision 2 feedback in the user's `Folding.md`: put Fold immediately
before Diagram in the workspace rail, replace the valley/mountain/precrease/
reverse letter marks with the requested symbols, and remove the Planned group.

## Approach

Use the shared workspace order and Fold tool catalog so desktop and phone
surfaces agree. Draw the icons as small native SVGs: V, inverted V, a sheet
with a crease and fold/unfold arrow, and a simplified crane head. Match the
other icons' neutral color and active state (user follow-up). Preserve
accessible tool names, shortcuts and tool behavior. Keep styles
in the existing icon CSS module. Remove the unused planned-item presentation.
No engine, saved-model, Revision 1, or personal-note changes are needed.

## Affected Areas

- `apps/web/src/workspaces/workspaces.ts`: shared rail order.
- `apps/web/src/components/fold/`: shared icons, rail and phone tool sheet.
- `apps/web/src/fold/tools/`: catalog and rail groups.
- Existing workspace/catalog/rail tests and local browser verification.

## Checklist

- [x] Read Revision 2 and inspect both embedded reference images.
- [x] Move Fold immediately above Diagram.
- [x] Replace the four letter icons across shared controls.
- [x] Remove Planned from desktop and phone tool lists.
- [x] Update affected tests; run web lint, typecheck and focused tests.
- [x] Inspect the local app and record the result. Local only; no PR or push.

Validation: 61 tests across seven affected suites passed, including the phone
picker's unavailable-tool behavior. Web typecheck and lint passed (lint retains
the existing timeline virtualizer warning). Removed obsolete localization keys
through the normal extractor; i18n checks and `git diff --check` passed.
Browser inspection at localhost:5327 confirmed
workspace order, no Planned section, readable icons, and exact color equality
between each icon and its parent control, both active and inactive.

No Rust, WASM, file-format or shell behavior changed, so engine tests, a WASM
rebuild, native desktop checks and a production rebuild were unnecessary.
Existing command/tool instrumentation still applies; these presentation changes
add no new action requiring an analytics event.

Follow-up icon references (2026-10-14): Crimp now uses the paired horizontal
arrows; Squash and Swivel use flat square outlines with their characteristic
crease lines, without offset layers. The shared SVGs cover desktop and phone
tool pickers and inherit the same neutral ink as the other tools. Browser
inspection confirmed all three use the control's color with no transform.
29 existing rail/window tests, typecheck, focused ESLint and diff checks pass.
Only icon presentation changed; no new behavior tests or engine build needed.

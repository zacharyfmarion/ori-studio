# Settings Toggle Rows

## Goal

Replace the raw checkboxes on the Settings → Workspace tab with the shared
`Toggle` switch, so an immediately-applied on/off preference looks and behaves
the same everywhere in Settings. The Shortcuts tab already ships that shape
("Use Oriedita defaults"); Workspace was still using bare
`<label class="settings-checkbox"><input type="checkbox">`.

## Approach

Extract the toggle-row shape the Shortcuts tab hand-rolled into a shared
`SettingsToggleRow`, then use it for the three Workspace booleans. The
extraction is what makes the swap worth doing: the row carries three pieces of
wiring that must not be re-derived per call site.

- **No wrapping `<label>`.** The Radix switch is itself the control, so a label
  around it delivers the click twice and the preference toggles straight back.
  `aria-labelledby` / `aria-describedby` tie label and switch instead.
- **Generated ids.** The hand-rolled row hardcoded `id="use-oriedita-defaults-label"`.
  Four rows need four unique pairs, so the row uses `useId()`.
- **The copy stays a hit target.** A `<label>` checkbox let you click the text;
  a bordered row that only responds on the switch would be a smaller target than
  what it replaces, and `.settings-toggle-row` already promised `cursor: pointer`.
  The row forwards its own clicks, and the switch stops propagation so a direct
  hit does not toggle twice.

Copy is reused verbatim, so no new i18n keys and no translation work.

### Deliberately left as-is

- **Crease-pattern scroll gesture** (`cpWheelGesture`) — a two-way *named*
  choice, not a boolean. A switch would have to drop one of the two labels.
  Radios keep both readable.
- **"Assigned" filter** in the Shortcuts toolbar — a filter chip, not a
  preference. The tab's existing comment already draws that line.
- **"Don't ask again"** in `CommandDialogModal` — a transient dialog opt-in
  committed on confirm. A switch implies immediate effect, which that is not.

## Affected Areas

- `apps/web/src/components/settings/SettingsToggleRow.tsx` (new)
- `apps/web/src/components/SettingsModal.tsx`
- `apps/web/src/styles/theme.css`
- `apps/web/src/components/SettingsModal.test.tsx`

## Checklist

- [x] Add `SettingsToggleRow` with generated ids and row-click forwarding
- [x] Convert the three Workspace booleans to it
- [x] Move the Shortcuts defaults row onto it, so there is one implementation
- [x] Drop the dead `:has(input:focus-visible)` rule that no toggle row can match
- [x] Tests: the three toggles reflect and update the store, row-click works,
      the analytics toggle still reaches the analytics client
- [x] `npm run lint:web`, `typecheck:web`, `test:web`, `i18n:check`
- [x] Browser check of the Workspace tab

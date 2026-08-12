# Coming from Oriedita

Ori Studio can adopt the keyboard you already know from
[Oriedita](https://github.com/oriedita/oriedita), so your hands work on day one.

## Two steps

1. **In Oriedita:** open **Preferences**, then click **Export**. Save the
   `.oriconfig` file anywhere you like.
2. **In Ori Studio:** open **Settings ▸ Shortcuts** and click
   **Import from Oriedita…**, then pick that file.

Nothing changes until you review what the import would do and confirm it.

## What to import

The dialog offers two answers, because they are genuinely different requests.

**Match Oriedita's keyboard** applies Oriedita's own layout *plus* whatever you
customized. Pick this if you want the keyboard to feel like the Oriedita you came
from — Ori Studio's defaults deliberately differ (the crease-pattern editor uses a
home-row layout, `A`/`S`/`D`/`F` for the line types, where Oriedita uses
`M`/`V`/`L`).

**Only my customizations** applies just the hotkeys you changed in Oriedita and
keeps Ori Studio's layout everywhere else.

The distinction matters more than it looks. Oriedita's export only records the
hotkeys you *edited* — its shipped defaults live inside the application, not in
the file. So if you never customized anything, "only my customizations" has
nothing to apply.

## Why some shortcuts are skipped

The preview lists every shortcut it will not import, with the reason. The common
ones:

- **"Left blank in Oriedita."** Oriedita writes the same blank value when you
  clear a hotkey *and* when you reset one to its default — and most of its
  actions ship with no default. The two are identical in the file, so Ori Studio
  leaves that shortcut alone rather than guessing and unbinding something.
- **"Ori Studio has no matching action."** Oriedita has actions with no
  counterpart here (background images, folded-figure sizing, panel switching).
- **"… answers this key first."** Another shortcut already owns that key and wins.
- **Shift with a number or punctuation key.** A browser reports `Shift+1` as `!`,
  so a shortcut recorded that way could never fire. It is refused rather than
  imported as a key that silently does nothing.
- **Numeric keypad keys.** A browser cannot tell them from the main keyboard.

A shortcut that *is* imported but shares its key with a simulator control is
applied and marked — the simulator only claims those keys while a simulation has
focus, so the key still works the rest of the time.

## What is not imported

Only hotkeys. Oriedita's other preferences (colours, line widths, grid settings,
window state) are not carried over: its settings file records every value on
every save, with no way to tell which ones you actually chose, so importing them
would silently overwrite your Ori Studio settings with Oriedita's defaults.

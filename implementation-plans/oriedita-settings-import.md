# Oriedita Settings Import

> **Revision note.** This plan was rewritten after an adversarial review against
> the vendored Java and our own registry, plus an empirical oracle run against a
> real JDK (`KeyStroke`, `Properties.store`, `ZipOutputStream`). Six of the
> original design's rules were wrong in ways that would have shipped. The
> superseded decisions are recorded in "What the review changed" at the bottom,
> because each one is a trap the next person will otherwise re-derive.

## Goal

Let a user arriving from Oriedita make Ori Studio's keyboard behave like the
Oriedita they already have muscle memory for.

**Scope: hotkeys only.** Application preferences (`config.json`) are cut from v1
for a specific reason given under "Why preferences are out".

**One input: `<name>.oriconfig`** — a zip of Oriedita's app dir, written by
`FileSaveServiceImpl.exportPref` (`third_party/oriedita/.../FileSaveServiceImpl.java:218`).
The **Export** button that produces it sits in Oriedita's Preferences dialog
(`PreferenceDialog.java:459`), the same dialog as the hotkey editor, so a user
who customized hotkeys is already looking at it.

## The central design decision: import the *effective* keymap

The archive's `hotkey.properties` is **not a keymap**. It is a sparse delta:
`ResourceUtil.updateBundleKey` adds one key per hotkey the user edits, and the
232-key default table lives in the jar, never in the app dir.

Measured against the vendored jar table: **34 of 232 actions ship with a
binding; 198 ship unbound.**

That matters because Ori Studio's defaults deliberately *depart* from Oriedita's
— the CP editor adopted Brandon Wong's home-row layout (`A`/`S`/`D`/`F` for the
line types) where Oriedita uses `M`/`V`/`L`. See
`implementation-plans/cp-editor-keybind-adoption.md`.

So a delta-only import is a trap:

| User | Delta-only import gives them | What they wanted |
| --- | --- | --- |
| Never customized anything | **nothing at all** — still a foreign keyboard | Oriedita's layout |
| Customized 3 keys | Ori Studio's layout + their 3 keys | Oriedita's layout + their 3 keys |

Neither row is the goal. The import must reconstruct the user's **effective**
Oriedita keymap:

```
effective = vendored jar defaults  ⊕  archive deltas
```

We have the jar table vendored. It must be **snapshotted into a generated TS
module** (`orieditaDefaultHotkeys.generated.ts`) by a script that reads
`third_party/oriedita/oriedita/src/main/resources/hotkey.properties`, because
`third_party/` is not shipped to the browser. Generated, committed, and checked
by a test that re-reads the vendored file — so it cannot drift silently when the
upstream-drift skill advances the pointer.

The preview offers both, because the two intents are genuinely different:

- **Match Oriedita's keyboard** (default) — apply the effective keymap.
- **Only my customizations** — apply the deltas alone.

## Keystroke parsing — the rules, and why each exists

Empirically verified by running the real JDK APIs (oracle in the scratchpad;
findings mirrored below). `KeyStroke.toString()` emits **VK constant names**, and
every probe round-trips through `KeyStroke.getKeyStroke(String)`.

Four grammar facts, each measured, each a way a naive parser goes wrong:

- **`pressed` is optional.** `"ctrl B"` and `"E"` parse fine. Both dialects are
  live: all 34 vendored defaults use the short form, and the app-dir file uses
  the `toString()` form — *except* that restore-default (`PreferenceDialog.java:549`)
  writes the short form back verbatim, so a single file can hold both.
- **Modifier order is free on input, canonical on output.** `"ctrl shift Z"` and
  `"shift ctrl Z"` both parse, and both emit `shift ctrl pressed Z`. Upstream's
  own defaults are written `ctrl shift Z` (`hotkey.properties:72`), so a parser
  that hard-codes the canonical order rejects Oriedita's own bindings.
- **`control` is a synonym for `ctrl`.**
- **`button1` / `button2` / `button3` parse as modifier tokens** and round-trip
  through `toString()` (`ctrl button1 pressed B`), so the parser must reject them
  rather than silently strip them — stripping would bind Ctrl+B for a string that
  says Ctrl+Drag+B.

  *Corrected:* an earlier draft justified this by claiming a user pressing a key
  mid-drag records one. A JDK probe disproves that —
  `KeyStroke.getKeyStrokeForEvent` **strips every button mask**
  (`CTRL|BUTTON1` → `"ctrl pressed B"`), so Oriedita's capture dialog cannot
  produce these strings and only a hand-edited `hotkey.properties` can. The
  rejection still matters for robustness; it is not a realistic-input case, which
  is why it does not earn its own preview wording.

### Accept

| Input | Chord |
| --- | --- |
| `pressed A` … `pressed Z`, `pressed 0`…`9` | bare letter/digit |
| `ctrl pressed X`, `meta pressed X` | `primary` — **always**, see below |
| `alt pressed X` | `alt` |
| `shift pressed <letter>` | `shift` + letter |
| `pressed DELETE/ESCAPE/ENTER/SPACE/TAB/BACK_SPACE/INSERT/HOME/END/PAGE_UP/PAGE_DOWN` | named key |
| `pressed LEFT/RIGHT/UP/DOWN` | `arrowleft`… |
| `pressed F1`…`F24` | function key |
| `pressed PERIOD/COMMA/SLASH/SEMICOLON/QUOTE/BACK_QUOTE/MINUS/EQUALS/OPEN_BRACKET/CLOSE_BRACKET/BACK_SLASH` | the character |

### Reject, each with a distinct reason shown in the preview

- **`ctrl` + `meta` together** → not expressible; both collapse to `primary`.
- **`shift` + digit or punctuation** → *cannot ever fire.* Java records the
  unshifted VK (`shift pressed 1`), but our chords compare on `event.key`, which
  the browser reports as `!`. Importing it would create a silent dead key —
  precisely the failure this feature exists to avoid. Shift+**letter** is fine
  (`Shift+A` → `{shift, key:'a'}` from both sides).
- **`NUMPAD0`–`9`, `MULTIPLY`, `ADD`, `SUBTRACT`, `DECIMAL`, `DIVIDE`** →
  `KeyChord` has no key-location field, so a numpad binding is
  indistinguishable from the main-row key. `SUBTRACT` would silently collide
  with `viewport.zoomOut`'s `-`.
- **`altGraph`**, **`released …`** (dispatcher is keydown-only), **`typed <c>`**
  when the char is not representable, and any unrecognized VK name.
- **Menu-scope (`global`) targets with a key `acceleratorKey` cannot express.**
  `nativeMenu.ts:42`'s default branch passes unknown keys through verbatim, so
  an imported `arrowleft` would become an accelerator string Tauri cannot parse
  and the desktop menu build fails.

### `ctrl` and `meta` both become `primary`, always

Not a preference — a correctness requirement. `keyChordFromKeyboardEvent`
(`shortcuts.ts:584`) computes `primary = metaKey || ctrlKey` and then
`ctrl: event.ctrlKey && !primary`, which is **always false**. No real keydown can
ever produce a chord carrying `ctrl` or `meta`, so emitting one mints a
permanently dead binding.

## Merge semantics

Per key in the archive:

| Archive state | Action |
| --- | --- |
| Key present with a value | Bind it (subject to the rejections above). |
| Key **absent** | No opinion. In effective-keymap mode the jar default applies; in deltas-only mode nothing happens. |
| Key present but **empty** | **Skip and report — never unbind.** |

The empty case is the rule the original plan got backwards. `""` has two
producers: the Clear button (`SelectKeyStrokeDialog.java:140`) *and* the
per-hotkey **restore-default** button (`PreferenceDialog.java:549`), which writes
`""` whenever the jar default for that action is empty — true for **198 of 232
actions**. So an empty value overwhelmingly means "Oriedita's default, which is
no binding", not "unbind this in Ori Studio". Treating it as an unbind would
mass-erase Ori Studio's own layout.

## Action mapping

`ShortcutDefinition.upstreamAction` is the bridge, but **the inverse is not a
function**: **four** upstream actions are each claimed by two definitions —
`foldAction`, `foldedFigureMoveAction`, `koteimen_siteiAction`, and
`v_del_allAction`. An explicit `ORIEDITA_ACTION_TARGETS` table names the winner
for each; a test asserts the table covers every duplicate, so a new collision
fails CI instead of silently binding whichever came first.

`v_del_allAction` is the instructive one: it is claimed by `cp.deleteExtraVertices`
(global) *and* `cp.action.delete-extra-vertices` (crease-pattern), and **both
already default to Mod+Shift+V in the shipped registry**. That is a live
global↔crease-pattern shadowing pair today — harmless, because both run the same
sweep — and it is exactly the collision class `findShortcutConflict` cannot see.
It makes the worked example for `findShortcutShadowing`.

Also settled during implementation: **`viewport.cancel` must not be annotated
with `haltAction`.** Upstream's `HaltAction` aborts the running CAMV/fold
computation; our `viewport.cancel` cancels in-progress canvas input and clears
the selection. Different verbs — annotating them would move the wrong thing for
anyone who rebound "stop the running fold". Ori Studio has no fold-abort verb, so
`haltAction` stays unmapped until one exists.

Actions that must **never** receive an imported chord, because overrides bypass
the invariants `shortcutRegistry.test.ts` enforces on defaults:

- `uiStatus !== 'ready'` (not implemented).
- `placement === 'hidden-ui-only'`, unless it arms a visible tool.
- `edit.undo` / `edit.redo` — `ALWAYS_AVAILABLE_DEFAULT_SHORTCUTS` merges
  overrides with defaults rather than replacing, so they can be *added to* but
  never rebound or unbound. The preview must not claim otherwise.

Phase 0 annotates the menu/viewport definitions that have an honest counterpart.
**`gridConfigureAction` is excluded**: it is `G` upstream, which `foldAction`
already owns here, and annotating it would unbind one of them. `exitAction` is
excluded — it has no browser meaning, and `shortcuts.test.ts:174` pins it as
unmapped.

## Conflicts: model the real scope stack, not `shortcutScopesOverlap`

`findShortcutConflict` is unsound for this purpose. `shortcutScopesOverlap`
returns `false` for global↔crease-pattern, but at runtime
`shortcutScopeStackForContext` (`shortcutRuntime.ts:118`) orders the stack
`[simulator?, viewport, crease-pattern?, global]` and `handleShortcutKeyDown`
takes the **first** match. So a crease-pattern chord genuinely shadows a global
one — and an Oriedita import creates exactly that collision, since Oriedita is
single-scope and binds bare letters that our menu layer also uses.

The import therefore gets its own `findShortcutShadowing`, derived from the scope
stack, and leaves `findShortcutConflict` alone for the manual-capture UI whose
semantics are already established and tested.

### Hard vs conditional shadowing — and why conflating them breaks the import

Not every scope is always in the stack. `viewport` and `global` always are, and
`crease-pattern` is whenever the CP canvas is the editing context. But
**`simulator` is pushed only while a simulation owns the keyboard**, which is the
documented intent at `shortcuts.ts:9-15`.

So a crease-pattern chord that collides with a simulator chord is not dead — it
works normally and merely defers while a simulation is focused. The shipped
registry already relies on this: `colCyanAction: 'F'` / `simulator.toggleFaces`,
`senbun_henkan2Action: 'C'` / `simulator.toggleCreases`, and `deg2Action: 'R'` /
`simulator.replay` all coexist today, and the duplicate-chord test passes because
they sit in different scopes.

**Corrected after measurement.** An earlier draft of this section claimed the
distinction rescued four keys — `F`, `C`, `R`, `L`. That was measured *through* a
bug and is wrong. Only `C` and `L` are simulator-only collisions. `F` is also held
by `cp.action.line-type.auxiliary` and `R` by
`cp.action.draw-crease-angle-restricted5`, both crease-pattern bindings, so both
are hard shadows either way. The real claimant sets:

```
f -> cp.action.line-type.auxiliary          + simulator.toggleFaces
c -> cp.action.crease-toggle-mv             + simulator.toggleCreases
r -> cp.action.draw-crease-angle-restricted5 + simulator.replay
l ->                                          simulator.toggleLighting   (only)
```

The distinction is still necessary — without it `C` and `L` are lost, and a
simulator claimant sitting on top of a real one must not mask it (see the
classification note below). But it is worth two keys, not four.

Therefore:

- **Hard shadowing** (same scope, or a scope that is always ahead) → skip.
- **Conditional shadowing** (a `simulator` binding over a non-simulator one) →
  **apply**, and note it, so the preview can say the key also drives the
  simulator while one is focused.

Two further requirements:

- Conflicts created *within the import set itself* must be checked against the
  proposed overrides, built **completely** before checking — `getResolvedShortcuts`
  falls back to defaults for any id not yet present, which would otherwise report
  phantom conflicts during a key swap.
- Shadow resolution must run to a **fixed point**, not a single pass. Dropping a
  candidate *restores its target's default chord*, which can then collide with a
  candidate that already passed. Measured case: importing Mountain→Mod+S (dropped,
  Save wins) plus Valley→A leaves Mountain back on `A`, so a one-pass build applies
  Valley to a permanently dead key. The loop terminates because the survivor set
  only shrinks.

## Known limitation: the line-type family half-migrates

Measured on a clean profile (no prior customization), effective-keymap mode:

```
34 rows -> 17 apply, 7 hard-shadowed, 4 not bindable, 6 unmapped
```

Three of those shadowed rows are a chain worth naming, because the outcome is the
one this plan set out to avoid:

- `symmetricDrawAction` wants `R`, but our `cp.action.draw-crease-angle-restricted5`
  holds `R` — an Ori Studio addition with no Oriedita binding, so nothing moves it.
- `symmetricDrawAction` therefore keeps its Ori Studio chord `M`.
- `colRedAction` wants `M`, and is now blocked by the binding that failed to move.

So Valley reaches `V` and Edge reaches `L`, while Mountain stays on `A`. Same
shape for `foldAction`'s `F`, blocked by `cp.action.line-type.auxiliary`.

The root cause is that **the import never unbinds**. An Ori Studio action that
holds a chord Oriedita gives to something else, and that Oriedita does not bind
at all, keeps its key and blocks the import forever.

The fix is a *release* pass: in effective-keymap mode, an action that blocks an
imported binding and has no imported binding of its own yields its chord. That
would close the chain above. It is deliberately **not** in v1, because it means
the import starts removing shortcuts the user currently has — a materially
different consent question from "add these bindings", and one worth asking
explicitly rather than inferring. Tracked as the next step; the preview already
has the vocabulary for it (`shadowedTakes`).

## Why preferences are out of v1

`DefaultObjectMapper` registers serializers and disables
`FAIL_ON_UNKNOWN_PROPERTIES`, and sets **no `@JsonInclude` filter**. Jackson
therefore writes *every* `ApplicationModel` field on every save, always. Unlike
`hotkey.properties`, `config.json` **cannot express "the user never touched
this"**.

Importing it wholesale would overwrite the importer's Ori Studio settings with
Oriedita's *defaults*. Concretely: `mouseWheelMovesCreasePattern` defaults to
`true` (which **zooms** — `Canvas.java:535`, despite the name), our
`cpWheelGesture` defaults to `'pan'`, so every importer's canvas would silently
flip from pan to zoom whether or not they ever chose that.

The only available signal is "differs from `ApplicationModel.reset()`", which is
a guess, not a preference. A later phase can use it deliberately; v1 should not
guess. Deferred to `oriedita-preferences-import.md` when someone wants it.

## Affected Areas

- `apps/web/src/lib/orieditaImport/` — new. `keyStrokeNames.ts`,
  `parseKeyStroke.ts`, `javaProperties.ts`, `oriconfigArchive.ts`,
  `orieditaDefaultHotkeys.generated.ts`, `importPlan.ts`, + tests.
- `apps/web/src/keyboard/shortcuts.ts` — Phase 0 annotations;
  `ORIEDITA_ACTION_TARGETS`; `findShortcutShadowing`.
- `apps/web/src/store/shortcutStore.ts` — bulk `applyImportedShortcuts`.
- `apps/web/src/components/settings/OrieditaImportDialog.tsx` + a button in
  `SettingsModal.tsx`'s Shortcuts toolbar.
- `apps/web/scripts/` — the generator for the vendored default table.
- `apps/web/public/locales/**`, `docs/`.

## Checklist

### Phase 0 — registry groundwork
- [x] `upstreamAction` on the menu/viewport definitions with honest counterparts
      (excluding `gridConfigureAction`, `exitAction`).
- [x] `ORIEDITA_ACTION_TARGETS` for the four many-to-one collisions + test.
- [x] `findShortcutShadowing` derived from the real scope stack + test proving it
      catches global↔crease-pattern, which `findShortcutConflict` misses.

### Phase 1 — parsing (pure, no UI)
- [x] `keyStrokeNames.ts`: VK table + the reject classes.
- [x] `parseKeyStroke.ts`: returns `{ok, chord}` or `{ok:false, reason}`.
      ctrl/meta→primary; reject shift+non-letter, numpad, altGraph, released.
- [x] `javaProperties.ts`: `=`/`:`/whitespace separators, `\` continuations,
      `#`/`!` comments, **`\uXXXX` unescaping** (verified required), and the
      bound / empty / absent tri-state.
- [x] `orieditaDefaultHotkeys.generated.ts` + generator + drift test.
- [x] `importPlan.ts`: effective-vs-deltas modes, per-row outcome and reason.

### Phase 2 — archive
- [x] `oriconfigArchive.ts`: **central-directory** reader + `DecompressionStream('deflate-raw')`.
      Local headers are unusable — Java sets general-purpose bit 3 (measured
      flags `0x0808`), so their size fields are zero and a streaming reader
      silently yields empty entries.
- [x] Handle method 0 (STORED) even though `ZipOutputStream` never emits it.
- [x] Fixtures: the **real Java-generated** `sample.oriconfig`, one with no
      `hotkey.properties`, one truncated.

### Phase 3 — apply + UI
- [x] `applyImportedShortcuts` (single persist).
- [x] Import dialog: mode toggle, grouped rows, per-row reason, scope column.
- [x] Test: applying any plan yields zero *shadowed* chords, not merely zero
      same-scope duplicates.
- [x] Test: hidden / not-implemented / undo / redo never receive a binding.

### Phase 4 — finish
- [x] Analytics (hand-placed; bucketed counts + outcome enum; no filenames).
- [x] i18n: `npm run i18n:extract`, translate 8 locales, `npm run i18n:stamp`,
      `npm run i18n:check` — all run **from `apps/web`**, not the repo root.
- [x] Docs: Oriedita Preferences ▸ Export, then Settings ▸ Shortcuts ▸ Import.
- [x] Validate: `npm run lint:web`, `npx tsc --noEmit`, `npx vitest run`.

## What the review changed

Six rules in the first draft were wrong. Each is recorded because the reasoning
that produced them is plausible enough to recur.

| Was | Is | Why |
| --- | --- | --- |
| Import the deltas | Import the *effective* keymap | Deltas alone are a no-op for the user who never customized, and a hybrid for everyone else. |
| `fooAction=` means "unbind" | Ambiguous → skip and report | Restore-default writes it too, for 198 of 232 actions. |
| `meta`→`meta` when `ctrl` present | Both → `primary`, always | `ctrl`/`meta` are structurally unreachable from a keydown. |
| Map every VK name | Reject shift+non-letter, numpad, altGraph | They cannot fire, or cannot be distinguished. |
| Reuse `findShortcutConflict` | New `findShortcutShadowing` | It is blind to the global↔crease-pattern shadowing an import creates. |
| Phase 4 imports preferences | Cut from v1 | `config.json` cannot express "unchanged", so importing it overwrites with Oriedita's defaults. |

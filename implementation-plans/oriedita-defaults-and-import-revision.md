# Oriedita Defaults Toggle, and Import Revision

Follow-up to `oriedita-settings-import.md`, which shipped the importer. Five
changes: one reframes the feature, and one generalizes its best idea to the rest
of the shortcuts UI.

## Goal

Separate two questions the current import conflates:

1. **Which keyboard layout am I on?** — Ori Studio's, or Oriedita's. That is a
   standing preference, not a one-time decision buried in an import dialog.
2. **What did I personally customize?** — that, and only that, is what an
   `.oriconfig` should carry over.

Today a single "What to import" toggle tries to answer both, which is why the two
options do not read clearly: *Match Oriedita's keyboard* silently means "apply 34
vendored defaults plus your edits", and *Only my customizations* means "your edits
onto our layout". Neither name says that, and nothing afterwards tells you which
world you ended up in.

Splitting them makes each honest, and dissolves the confusing toggle rather than
rewording it.

## The five changes

### 1. A `Use Oriedita defaults` toggle in Settings ▸ Shortcuts

A persistent preference selecting which table `defaultChords` resolves against.

- Off (default): Ori Studio's layout — Brandon Wong's home row, `A`/`S`/`D`/`F`.
- On: Oriedita's layout — `M`/`V`/`L`, `F` to fold, `R` to mirror.

**Reset follows the toggle.** Per-row reset and *Reset All* restore whichever
source is active, which is the behaviour asked for and the only one that is not
a trap: a user on Oriedita defaults who hits Reset must not be dropped back onto
a layout they deliberately left.

**Switching the source does not touch overrides.** A key the user set by hand is
theirs; it survives the switch and still shows as customized. Only unoverridden
actions move.

**Switching asks first, and says what moves.** The toggle rewrites most of the
keyboard, so it confirms rather than acting on a click:

> **Use Oriedita defaults?**
> This changes 22 shortcuts. Mountain moves to M, Valley to V, Fold to F, and 19
> others.
> 3 shortcuts you customized are unaffected.
> [Cancel] [**Use Oriedita defaults**]

The counts are computed by diffing the effective keymap before and after, so the
dialog cannot drift from what actually happens. If the diff is empty the toggle
just flips — there is nothing to warn about.

The line worth getting right is the last one. Overrides survive, so a key the user
set by hand can now sit on top of a *different* base, and may collide with a
binding the new layout introduces. Those are called out by name:

> 1 shortcut you customized now clashes: yours is on M, which Oriedita gives to
> Mountain.

The confirmation does not try to resolve that — it names it, and change 4 gives
the user a one-click way to settle it in the list afterwards. Auto-re-homing
someone's deliberate choice is exactly the silent rewrite this feature exists to
avoid.

### 2. Import carries customizations only

The mode toggle goes away. An import applies exactly the keys present in the
archive — the user's own edits — and nothing else. "I want Oriedita's layout" is
now answered by the toggle in change 1, before or after importing, in either
order.

This also simplifies the plan builder: `effective-keymap` mode, the vendored
default overlay, and the `source: 'archive' | 'oriedita-default'` row field all
disappear from the import path. `ORIEDITA_DEFAULT_HOTKEYS` does not disappear —
it moves, becoming the input to the defaults table in change 1.

### 3. Per-row override for a skipped shortcut

Eviction exists (a shortcut can give up its key), but it is all-or-nothing at
Apply time. Move it onto the row:

A row skipped as `shadowed` gains a **Use anyway** action, reading e.g.
*"Angle Restricted Line answers R first — Use anyway"*. Choosing it re-plans with
that one eviction permitted; the row flips to applied, and the displaced binding
is listed under a **Will be unbound** group so it is never a surprise.

`allowEviction: boolean` becomes `allowEvictionFor: ReadonlySet<ShortcutActionId>`,
so the machinery already built and tested is reused with a narrower input. The
bulk confirmation is dropped — per-row consent is strictly better, and keeping
both would ask the same question twice.

### 4. Binding a taken key by hand offers to unbind the other one

Requested directly by a user: *"I want to bind mountain line to M but M is mirror
by default. Instead of just not letting me bind the key, can it switch mirror line
to unassigned and let me bind mountain to M."*

Today Settings ▸ Shortcuts refuses. Capture a chord that is taken and you get
*"Mod+M is already assigned to Mirror Line."* and nothing happens — a dead end
with no way through, which is the same complaint change 3 fixes for imported rows.

Instead: confirm, then do it.

> **Unbind Mirror Line?**
> Mirror Line uses M. Assigning it to Mountain leaves Mirror Line unassigned.
> [Cancel] [**Unbind and assign**]

On confirm the new binding is written and the previous holder becomes unassigned,
visible as such in the list. One store action, so a single persist and a single
undoable step rather than two.

**This is change 3's mechanic, reached from the other direction.** Import and
manual capture are the two ways a user assigns a key, and they should not disagree
about what happens when it is taken. Building it once, shared, is most of why it
belongs in this plan rather than its own.

Three constraints carry over from the import work, and each is a real bug if
missed:

- **Ask `findShortcutShadowing`, not `findShortcutConflict`.** The latter reports
  `null` for a crease-pattern binding shadowing a global one, so the capture UI
  would accept a chord that then fires the wrong action. Only `kind: 'hard'`
  prompts.
- **A `conditional` (simulator) collision must not prompt at all.** Those coexist
  by design — `C`, `L` and `R` are shared today — and offering to unbind the
  simulator would be offering to break something that works.
- **Never offer to unbind Undo/Redo.** `shortcutKeepsDefaultChords` merges rather
  than replaces, so the `null` would not take and the dialog would promise
  something that silently does not happen.

### 5. Right-align the chord column

`.oriedita-import__row` sets `grid-template-columns: minmax(0, 1fr) minmax(96px, auto)`,
but `.settings-shortcuts__row` — which the same element also carries — is defined
**later in `theme.css` at equal specificity**, so its five-column template wins.
The chord lands in column 2 with three empty columns to its right, which is the
odd gap.

Fix by scoping the override so it wins on specificity rather than order
(`.oriedita-import .settings-shortcuts__row`), not by moving blocks around, since
source order is a fragile thing to depend on twice.

## Approach

### Where the defaults table comes from

`ORIEDITA_DEFAULT_HOTKEYS` already holds the 34 bound upstream actions, generated
from `third_party/oriedita/.../hotkey.properties` and drift-guarded by a test.
The new table is derived from it at module load, not hand-written:

```
orieditaAction -> shortcutIdForOrieditaAction -> parseOrieditaKeyStrokeStrict -> chord
```

Entries that do not map, do not parse, or are unbindable are dropped — the same
predicates the importer already uses, so the two cannot disagree.

**Ori Studio-only actions keep their own default where it does not collide** —
decided, not open. Oriedita has no binding for radial snapping, the measure tools,
or the inline simulator, and silently unbinding ~40 tools to be "pure" would be
worse than the half-migration this plan is fixing. Where an Ori Studio-only
default *does* collide with an Oriedita binding, Oriedita wins and ours is
dropped, because the point of the toggle is that Oriedita's keys are where the
user expects them. The merge is precomputed and a test asserts the result is
duplicate-free per scope — the same invariant `getShortcutRegistryDiagnostics`
enforces on the shipped table.

That precomputation is what makes this simpler than the importer: the layout is
internally consistent by construction, so none of the shadowing, eviction, or
fixed-point machinery is involved in switching.

### Threading the preference

Resolution currently reads `definition.defaultChords` directly. The blast radius
is small — measured: **8 `getResolvedShortcuts` calls, 2 `getResolvedShortcut`,
across 4 non-test files** (`shortcuts.ts`, `shortcutDispatcher.ts`,
`SettingsModal.tsx`, `importPlan.ts`), plus `nativeMenu.ts` and
`menuDefinition.ts` via the singular form.

Add the source to the resolution context that already flows to those call sites:

```ts
export interface ShortcutResolution {
  overrides?: ShortcutOverrides;
  defaultsSource?: ShortcutDefaultsSource;   // 'ori-studio' | 'oriedita'
}
```

Every site that threads `overrides` today (dispatcher, runtime, native menu,
settings) threads this object instead. Explicit and type-checked.

**Rejected alternative:** module-level mutable state set by the store, so
signatures stay put. It reads cleaner at the call sites and is how
`shortcutRuntime` holds executors — but resolution is a pure function used
heavily in tests, and a global would leak between cases and make a test's
meaning depend on execution order. Not worth it for ten call sites.

### Store and persistence

`defaultsSource` joins `useShortcutStore`, persisted alongside `bindings` in the
existing `oristudio:shortcuts` record (bump `version` to `2`; a `version: 1`
payload reads as `'ori-studio'`). It sits with the shortcut state rather than
`settingsStore` because every reader of it is a shortcut reader, and splitting
them would mean two subscriptions for one answer.

Changes 3 and 4 share one store action:

```ts
assignShortcut(id, chord, { unbind?: readonly ShortcutActionId[] })
```

It writes the new binding and the `null` overrides together in a single persist.
Two calls would leave a window where the chord is claimed twice, and would put two
entries in whatever undo history this grows later. `applyImportedShortcuts` keeps
its bulk shape; this is the single-assignment sibling.

## Risks

- **The dispatcher must see the switch.** `handleShortcutRuntimeKeyDown` receives
  `overrides` from a store subscription; the source has to arrive the same way or
  the toggle changes the Settings list and nothing else. A test should drive a
  real chord through the dispatcher under each source.
- **Native menu accelerators** rebuild from `getResolvedShortcut`. Under the
  Oriedita source some menu chords change, so the Tauri menu must rebuild on
  toggle — the same path the existing override sync uses.
- **`shortcutKeepsDefaultChords`** (Undo/Redo merge rather than replace) is
  defined against *the* defaults. Under a second source it must mean "the active
  source's defaults", or Undo silently gains a chord from the inactive table.
- **The two entry points must not diverge.** Import and manual capture answering
  the "key is taken" question differently is the failure this plan exists to
  remove; the shared predicate and the shared store action are what stop it, and
  a test should assert both paths reach the same decision for one chord.
- **The drift guard now protects two things.** If upstream moves a binding, both
  the import mapping and the shipped layout shift. The existing test covers the
  table; it should be extended to assert the derived layout too.

## Affected Areas

- `apps/web/src/keyboard/shortcuts.ts` — `ShortcutDefaultsSource`,
  `ShortcutResolution`, the derived Oriedita layout, resolution changes.
- `apps/web/src/keyboard/shortcutDispatcher.ts`, `shortcutRuntime.ts` — thread it.
- `apps/web/src/store/shortcutStore.ts` — `defaultsSource`, persistence v2, reset
  semantics.
- `apps/web/src/components/SettingsModal.tsx` — the toggle; "Default" column and
  reset follow the source.
- `apps/web/src/menus/nativeMenu.ts` — rebuild accelerators on toggle.
- `apps/web/src/lib/orieditaImport/importPlan.ts` — drop modes and the default
  overlay; `allowEvictionFor` set.
- `apps/web/src/components/settings/OrieditaImportDialog.tsx` — remove the mode
  control, add per-row **Use anyway**, add **Will be unbound**.
- `apps/web/src/styles/theme.css` — chord column specificity fix.
- Locales ×8, `docs/coming-from-oriedita.md`.

## Checklist

### Phase 1 — the defaults source
- [ ] Derive the Oriedita layout from `ORIEDITA_DEFAULT_HOTKEYS`; keep
      non-colliding Ori Studio-only defaults; assert duplicate-free per scope.
- [ ] `ShortcutResolution` context; migrate the ~10 call sites.
- [ ] `shortcutKeepsDefaultChords` resolves against the active source.
- [ ] Test: the same chord dispatches to different actions under each source.

### Phase 2 — store, reset, and the toggle
- [ ] `defaultsSource` in `shortcutStore`, persisted, v1 payloads read as `ori-studio`.
- [ ] Reset (row and all) restores the active source; overrides survive a switch.
- [ ] Toggle in Settings ▸ Shortcuts; "Default" column reflects the source.
- [ ] Switching confirms, with counts diffed from the real before/after keymaps
      and any clashing customization named. Empty diff flips without asking.
- [ ] Test: the confirmation's counts match the bindings that actually change, and
      cancelling leaves both the preference and the keymap untouched.
- [ ] Native menu rebuilds on toggle.

### Phase 3 — unbind-on-conflict, both entry points
- [ ] `assignShortcut(id, chord, { unbind })` on the store: one persist.
- [ ] Capture flow asks `findShortcutShadowing`; only `hard` prompts; `conditional`
      binds silently; Undo/Redo never offered.
- [ ] Confirmation naming the displaced action; on confirm it reads Unassigned.
- [ ] Test: import and manual capture agree on the same contested chord.

### Phase 4 — import revision
- [ ] Delete `effective-keymap`, the default overlay, `source`, and the mode UI.
- [ ] `allowEvictionFor` set; per-row **Use anyway**; **Will be unbound** group.
- [ ] Drop the bulk eviction confirmation.
- [ ] Re-verify against the real fixture and the no-extension export.

### Phase 5 — finish
- [ ] Chord column specificity fix.
- [ ] i18n ×8, `i18n:check`.
- [ ] Update `oriedita-settings-import.md` to point here for the parts superseded.
- [ ] `npx tsc --noEmit`, `npx vitest run`, `npm run lint:web`.

## Settled questions

Both open questions from the first draft are now decided:

- **Ori Studio-only tools** keep their key under the Oriedita source where it does
  not collide; where it does, Oriedita wins. See "Where the defaults table comes
  from".
- **Existing overrides are never re-homed.** Switching confirms, reports how many
  shortcuts move, and names any customization that ends up clashing with the new
  base — but it does not silently rewrite the user's own choices. Resolving a
  clash is a deliberate act, and change 4 is where it happens.

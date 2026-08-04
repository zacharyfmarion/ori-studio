# CP Tool Variant Params

## Goal

Collapse two pairs of near-duplicate rail tools into one tool each, with the
difference exposed as a tool param in the context panel:

| Today: two rail buttons | Becomes: one tool | Param |
| --- | --- | --- |
| Extend Line (`LengthenCrease`) + Lengthen by Same Color (`LengthenCreaseSameColor`) | **Extend Line** | Color: Active / Same as original |
| Equally Divided Line (`LineSegmentDivision`) + Divided Line (ratio) (`LineSegmentRatioSet`) | **Divided Line** | Divide by: Count / Ratio |

Four rail buttons become two. The Draw group is by far the most crowded on the
rail — 17 visible entries against 5 for Transform and 4 for Select — and both
pairs are near-identical glyphs sitting next to each other, so the merge buys
real scanability, not just tidiness.

**The kernel does not change.** All four `OperationId`s stay exactly as they
are — this is a UI-layer merge only. See "Why the merge is UI-only" below.

## Upstream reference

Oriedita ships these as four separate buttons and four separate
`MouseHandler` classes, so combining them is an Ori Studio UI addition on top of
a faithful port, not a parity divergence. The ported behavior underneath is
untouched.

| Pair | Upstream handlers | What actually differs |
| --- | --- | --- |
| Extend | `MouseHandlerLengthenCrease` / `MouseHandlerLengthenCreaseSameColor` | One enum arg: `LengthenColorMode::Current(color)` vs `::SameAsOriginal` — `crates/oristudio-cp/src/lib.rs:2540-2585`, enum at `crates/oristudio-cp/src/operations/transform.rs:20` |
| Divide | `MouseHandlerLineSegmentDivision` / `MouseHandlerLineSegmentRatioSet` | Which kernel fn runs on the same two dragged points: `divide_segment_by_count(n)` vs `divide_segment_by_ratio(s, t)` — `crates/oristudio-cp/src/lib.rs:1752-1770` |

Both pairs already share an input model, which is what makes the merge safe:
`inputModelRegistry.ts:117-118` gives both divide ops `drag-line`, and
`:147-148` gives both lengthen ops `lengthen`. Neither pair differs in how the
user gestures — only in what the kernel does on commit.

## Why the merge is UI-only

Merging the `OperationId`s themselves would be wrong on two counts:

1. **Parity.** The `OperationId` enum is 1:1 with Oriedita's `MouseHandler*`
   classes, and that mapping is the contract the oracle tests and
   `PORTING.md` are written against. Collapsing two handlers into one
   parameterized handler makes every future diff against
   `third_party/oriedita` harder to read for no product gain.
2. **`.osf` round-tripping.** Native Oriedita files carry the active mouse mode,
   and Ori Studio restores the tool from it via `cpActionByUpstreamMouseMode`
   (`oristudioCpActions.ts:714`, called from `CreasePatternPanel.tsx:1455` and
   `orieditaNativeMetadata.ts:183`). All four of `LENGTHEN_CREASE_5`,
   `LENGTHEN_CREASE_SAME_COLOR_70`, `LINE_SEGMENT_DIVISION_27`, and
   `LINE_SEGMENT_RATIO_SET_28` must keep resolving to *something*.

So the four operations stay. What merges is the **action** — the rail-facing
identity — and the resolution from action to operation becomes a function of the
tool options.

## Approach

### The seam: resolve the operation id once

Today `activeOperationId` is copied straight off the action
(`oristudioCpToolState.ts:119`, `:152`). The whole change is to make that one
assignment a function of `(action, toolOptions)` instead.

That single seam is enough because **every downstream consumer already keys off
the operation id**, and each of them already has the right answer registered for
both variants:

| Consumer | Where | Already variant-correct |
| --- | --- | --- |
| Which context-panel groups render | `cpToolSettingGroupsForOperation` — `oristudioCpToolSettings.ts:259` | `LengthenCrease` is in `LINE_COLOR_OPERATION_IDS` (`:150`) and `LengthenCreaseSameColor` is not, so the "Line type" readout appears and disappears with the mode, correctly, for free |
| Command payload fields | `cpCommandPayloadDefaults` — `CreasePatternPanel.tsx:341`, division at `:388-395` | `division_count` vs `ratio_s`/`ratio_t` already branch on operation id |
| Live preview stroke color | `CP_ACTIVE_LINE_COLOR_OPERATIONS` — `oristudioCpCommands.ts:974` | `LengthenCreaseSameColor` is deliberately excluded (see the comment at `:971`), so the preview stops previewing in the active crease color exactly when the mode says it should |
| Tool-hint text | `resolvedOrieditaInstructionKey` — `oristudioCpToolInstructions.ts:437` | Both `lengthenCreaseAction` and `lengthenCrease2Action` have distinct instruction entries at `:253` / `:260` |
| Rail glyph | `ORIEDITA_OPERATION_GLYPHS` — `CpToolRail.tsx:273` | All four glyphs registered at `:300-303` |
| Pointer routing | `isLengthenCreaseOperation` — `predicates.ts:17` | Already accepts both |

This is the reason to do it this way rather than branching on a param at each
call site: the branching already exists and is already correct. It just needs to
be reached.

### New module: `lib/cpToolVariants.ts`

One React-free, store-free table as the single source of truth.

*(As built: this was planned for `cp-workspace/tools/`, but `lib/oristudioCpToolState.ts`
needs it and `lib/` may not depend on `cp-workspace/`. It sits with the other CP
data modules instead. The React side — arming with the current options, the
re-resolve effect, the resolved command — is `cp-workspace/tools/useCpToolVariant.ts`.)*

```ts
export const CP_TOOL_VARIANT_GROUPS = {
  'lengthen-color': {
    optionKey: 'lengthenColorMode',
    hostOperationId: 'LengthenCrease',
    variants: {
      same:   { operationId: 'LengthenCreaseSameColor', mouseMode: 'LENGTHEN_CREASE_SAME_COLOR_70' },
      active: { operationId: 'LengthenCrease',          mouseMode: 'LENGTHEN_CREASE_5' },
    },
  },
  'divide-mode': {
    optionKey: 'divideMode',
    hostOperationId: 'LineSegmentDivision',
    variants: {
      count: { operationId: 'LineSegmentDivision', mouseMode: 'LINE_SEGMENT_DIVISION_27' },
      ratio: { operationId: 'LineSegmentRatioSet', mouseMode: 'LINE_SEGMENT_RATIO_SET_28' },
    },
  },
} as const;
```

Derived lookups, all pure:

- `resolveCpVariantOperation(operationId, options)` — the seam above. Returns
  `operationId` unchanged for every non-variant tool.
- `cpVariantGroupForOperation(operationId)` — the group, or `null`.
- `cpVariantHostOperation(operationId)` / `cpVariantOptionPatch(operationId)`.
- `cpToolSelectionForMouseMode(mouseMode)` — `{ action, options? }`, so the
  `.osf` restore lands on the host action *and* sets the mode. Note every member
  of a pair carries a mode, the host included: the host is one of the variants,
  not a neutral default, so returning nothing for it would restore a file saved
  in Active colour into whatever mode was last used.

### Tool options

Two new keys in `OristudioCpToolOptions` (`oristudioCpToolSettings.ts:44`),
following the existing pattern exactly:

```ts
lengthenColorMode: 'same' | 'active';
divideMode: 'count' | 'ratio';
```

Defaults — `lengthenColorMode: 'same'`, `divideMode: 'count'`. See "Decisions"
for why `'same'`.

Two new setting groups, `'lengthen-color-mode'` and `'divide-mode'`, each
rendering a `SegmentedControl` (`components/ui/SegmentedControl.tsx`). Both must
be registered in `TOOL_OPTION_KEYS_BY_GROUP` (`oristudioCpToolSettings.ts:231`)
— the doc comment there is explicit that a group rendering an option it does not
claim is a setting the panel's reset cannot reach.

The group tables then read:

```ts
LengthenCrease:          ['lengthen-color-mode'],
LengthenCreaseSameColor: ['lengthen-color-mode'],
LineSegmentDivision:     ['divide-mode', 'division-count'],
LineSegmentRatioSet:     ['divide-mode', 'division-ratio'],
```

Both variants of a pair list the same selector, so the selector is present
whichever way the mode is set — and for divide, the count/ratio control below it
swaps automatically with the resolved operation. No new conditional rendering in
the panel.

### Persistence

Both mode params are persisted. They are "how I work" settings in exactly the
sense `cpToolOptionPersistence.ts` describes — a designer who extends creases in
their original color does that every time, not once — and persisting the
lengthen mode is also what keeps the `E` shortcut stable across sessions.

They opt in through `PERSISTED_CP_TOOL_OPTIONS` (`cpToolOptionPersistence.ts:80`),
the existing registry, not through a new module. (`measurePreferences.ts` is the
other persisted-preferences module, and the two are not interchangeable: measure
units are their own shape under the `cpMeasure` storage key, whereas anything in
`OristudioCpToolOptions` belongs to the tool-options registry under
`cpToolOptions`.)

A registry entry *is* the key's validator, and the file currently has
`integerIn`, `finiteIn`, and `boolean` — none of which fits a string union. So
this needs one small new helper alongside them:

```ts
function oneOf<T extends string>(values: readonly T[]) {
  return (value: unknown): T | null =>
    typeof value === 'string' && (values as readonly string[]).includes(value)
      ? (value as T)
      : null;
}
```

**Persist `divisionCount` and `divisionRatio` at the same time.** They are on
that file's list of "reasonable candidates left ephemeral for now", and leaving
them there once `divideMode` persists produces exactly the half-restored state
the registry's `angleSystemDivider` / `angleSystemAngles` comment warns about:
the tool would come back in Ratio mode with the ratio reverted to the
`1:sqrt(2)` default. Persist the mode and its operand together or neither. The
same argument does not apply to the lengthen pair — its mode has no operand — so
`lengthenColorMode` can be persisted alone.

That makes four new registry entries, and the doc comment listing ephemeral
candidates needs its `divisionCount` / `divisionRatio` mentions removed.

### Rail and actions

The two secondary actions become `placement: 'hidden-ui-only'` — they stay in
`ORISTUDIO_CP_ACTIONS` (parity, mouse-mode lookup) but leave the rail. The two
host actions keep their rail slots and orders (50 and 180).

Labels: Extend keeps **"Extend Line"** (already the override at
`oristudioCpActions.ts:194`). Divide becomes **"Divided Line"**, replacing
"Equally Divided Line" and "Divided Line (ratio)".

Glyph: the rail button for an active variant tool should show the *resolved*
operation's glyph, so the mode is readable without opening the panel. `E011`
(equal ticks) and `E044` (ratio) are genuinely different pictures. `CpToolButton`
resolves `ORIEDITA_ICON_GLYPHS[action.upstreamAction]` before
`ORIEDITA_OPERATION_GLYPHS[action.operationId]` (`CpToolRail.tsx:454-456`), so
this needs the resolved operation id threaded into `CpToolRail` and preferred
for the active button only.

`cpHiddenActions()` (`oristudioCpActions.ts:738`) carries an invariant asserted
in `shortcutRegistry.test.ts`: a hidden action must not hold a default chord.
`E` is currently bound to `lengthenCrease2Action`
(`keyboard/shortcuts.ts:125`), which is about to become hidden — so the binding
moves to `lengthenCreaseAction`, the host.

## Decisions

**`lengthenColorMode` defaults to `'same'`, not `'active'`.** Because the mode
is persisted, this decides behavior on first run only — after that the user's
own last choice wins. Still worth stating plainly, since it is the one
user-visible change either way:

- Today `E` selects the *same-color* variant, and `E` is in the adopted
  single-key layout — it is muscle memory, and it mirrors Oriedita's own
  `lengthenCrease2Action` binding.
- Today the rail's "Extend Line" button selects the *active-color* variant.

Merging means one of those two entry points changes what it does on first use.
Defaulting to `'same'` preserves the keyboard path (the one with adopted-layout
weight behind it), changes the rail button, and — since the mode is now visible
in the panel and persisted — costs a user who wants active-color exactly one
click, once. Defaulting to `'active'` would silently change what a memorized
keystroke does, which is the worse failure.

**Shortcuts select the tool but do not set the mode.** Making a chord carry a
param is a change to the shortcut registry's shape, and it is not needed here:
with the mode persisted, `E` lands the user where they left off. Worth
revisiting only if someone asks for `E` / `Shift+E` as two modes.

## Affected Areas

**No Rust, no wasm.** Every file below is under `apps/web/`.

| Area | Files |
| --- | --- |
| New | `src/cp-workspace/tools/toolVariants.ts` + test |
| Options and groups | `src/lib/oristudioCpToolSettings.ts`, `src/lib/cpToolOptionPersistence.ts` |
| Resolution seam | `src/lib/oristudioCpToolState.ts` |
| Actions and rail | `src/lib/oristudioCpActions.ts`, `src/components/panels/CpToolRail.tsx` |
| Context panel controls | `src/components/panels/CpContextToolPanel.tsx` |
| Payload + `.osf` restore | `src/components/panels/CreasePatternPanel.tsx` (`cpCommandPayloadDefaults`, the mouse-mode restore effect at `:1455`) |
| Command labels | `src/lib/oristudioCpCommands.ts` |
| Shortcut | `src/keyboard/shortcuts.ts` |
| i18n | `public/locales/*/cpVocab.json` (generated), `public/locales/*/tools.json` (8 locales) |

Tests to update: `oristudioCpToolSettings.test.ts:41-46`,
`oristudioCpCommands.test.ts:51`, `:236`, `shortcutRegistry.test.ts:112`,
`predicates.test.ts:35-37`, `oristudioCpActions.test.ts` (mouse-mode
round-trip), `i18n/cpVocab.gen.test.ts` (regenerated).

## Checklist

### Phase 0 — variant model

- [x] Add `toolVariants.ts` with the group table and the three pure lookups.
- [x] Unit-test `resolveCpOperationId` for both pairs and for a non-variant tool
      (must return its own id untouched).
- [x] Add `lengthenColorMode` / `divideMode` to `OristudioCpToolOptions` and its
      defaults.
- [x] Register both keys in `TOOL_OPTION_KEYS_BY_GROUP`.
- [x] Add the `oneOf` string-union validator to `cpToolOptionPersistence.ts`.
- [x] Opt `lengthenColorMode`, `divideMode`, `divisionCount`, and
      `divisionRatio` into `PERSISTED_CP_TOOL_OPTIONS`, and drop the last two
      from the module comment's ephemeral-candidates list.
- [x] Test the round trip and the rejection path: a stale or hand-edited mode
      string falls back to its default alone, leaving the other keys intact.

### Phase 1 — resolution seam

- [x] Resolve the operation id from `(action, toolOptions)` where tool state
      records `activeOperationId`; thread tool options to that call site.
- [x] Verify the four downstream consumers in the table above pick up the
      resolved id with no further branching (payload, settings groups, preview
      color, hint text).
- [x] Re-resolve when the mode changes while the tool is already active — the
      context panel must not need a tool reselect to take effect.

### Phase 2 — rail and panel

- [x] Map both variants of each pair to the new selector groups in
      `TOOL_SETTING_GROUPS_BY_OPERATION`.
- [x] Render both selectors as `SegmentedControl` groups in
      `CpContextToolPanel`.
- [x] Hide the two secondary actions (`placement: 'hidden-ui-only'`); relabel
      the divide host to "Divided Line".
- [x] Show the resolved operation's glyph on the active rail button.

### Phase 3 — shortcut and file restore

- [x] Move the `E` binding from `lengthenCrease2Action` to
      `lengthenCreaseAction`; update `shortcutRegistry.test.ts`.
- [x] Route `.osf` mouse-mode restore through
      `cpVariantSelectionForMouseMode` so a file saved in either variant lands
      on the host action with the right mode set.
- [x] Confirm `orieditaNativeMetadata` still reports "Canvas tool" as restored
      for all four mouse modes.

### Phase 4 — i18n and validation

- [x] `npm run i18n:extract`, translate the new `tools:` strings and the changed
      `cpVocab` labels across all 8 locales, `npm run i18n:stamp`.
- [x] `npm run i18n:check` passes.
- [x] `npx tsc --noEmit` and vitest pass. (Use these directly rather than
      `npm run typecheck:web` — the npm scripts regenerate the tracked wasm
      bindings nondeterministically and would dirty the diff.)
- [x] `npm run lint:web` passes, including the `max-lines` cap on
      `CreasePatternPanel.tsx` and `CpContextToolPanel.tsx`.

### Browser verification (author)

- [ ] Extend Line: both modes extend correctly; the "Line type" readout appears
      in Active mode and is gone in Same mode; the drag preview is drawn in the
      active crease color only in Active mode.
- [ ] Divided Line: the count and ratio controls swap with the mode; each still
      commits what it did as a separate tool.
- [ ] `E` selects Extend Line and lands in the last-used mode after a reload.
- [ ] Open an `.osf` saved with each of the four mouse modes active; the right
      tool is selected with the right mode.

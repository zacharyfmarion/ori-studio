# Viewport Shortcut Rebinding

## Goal

Make the chords held by always-claiming viewport bindings assignable to
something else, through both paths a key gets bound — capturing a chord in
Settings ▸ Shortcuts, and importing an Oriedita `.oriconfig` — with the same
answer from both.

Reported by a user arriving from Oriedita with `5` bound to Divided Line. The
import marked the row skipped with no way through, and rebinding `5` by hand
answered "5 is already assigned to Zoom Out." and stopped there. Eleven chords
are unreachable this way: `Mod+=` `6` `Mod+-` `5` `Mod+0` `Mod+1` `1` `3` `4`
`Escape` `Shift+S`.

## The bug

`viewport` outranks `crease-pattern` in `SHORTCUT_SCOPE_PRECEDENCE`
(`shortcuts.ts:869`), so a viewport binding on `5` hard-shadows any CP tool that
wants it. Both assignment paths then refuse to displace it:

- `decideCapture` (`SettingsModal.tsx:541`) —
  `if (shortcutKeepsDefaultChords(blocker.id) || blocker.scope === 'viewport')`
  returns `refuse`, so no unbind prompt is offered.
- `isSharedByDesign` (`importPlan.ts:588`) — `blocker.scope === 'viewport'`
  returns `true`, so `offersFor` attaches no `evictionOffer`, and
  `OrieditaImportDialog.tsx:225` renders "Use this key anyway" only when one
  exists.

Both cite the same justification: viewport executors decline a chord they do not
own and let it fall through, so unbinding one would break a coexistence that
works. That is true of `viewport.delete` — it hands Delete back to `edit.delete`
when nothing is selected — and false of `viewport.zoomOut`, which returns `true`
unconditionally (`CreasePatternPanel.tsx:2726`). The rule asks *which scope is
this in* when the property it cares about is *does this binding ever decline*.

**Which verbs decline is per-surface, not per-verb.** One viewport executor is
live at a time, chosen by editing context (`shortcutRuntime.ts:51`). The `tree`
and `bp-editor` surfaces implement only the four camera verbs and
`default: return false` the rest (`useViewportSurface.ts:181`,
`DesignPanel.tsx:657`), so "declines on every surface" would sweep in almost
everything. The surface that matters is the one live in the same context as the
binding being assigned — for a `crease-pattern` binding, the CP canvas, and
nothing else.

Read off the CP executor's switch, that gives:

| Verb | Chords | On the CP canvas |
| --- | --- | --- |
| `viewport.delete` | `Delete` `Backspace` | declines — selected object, else a measurement |
| `viewport.solveAnglesPrevious` | `←` | declines unless `vertexSolve.steppable` |
| `viewport.solveAnglesNext` | `→` | declines unless `vertexSolve.steppable` |
| `viewport.solveAnglesApply` | `Enter` | declines unless `vertexSolve.review` |
| the other ten | the eleven chords above | always claims |

## Approach

### 1. Declare the property the rule actually wants

Add `mayDecline?: true` to `ShortcutDefinition`, set it on those four, and export
`shortcutMayDecline(id)`. Only `target: 'viewport'` definitions may carry it —
the dispatcher ignores a non-viewport executor's return value
(`shortcutDispatcher.ts`), so the flag would be a lie anywhere else.

It is a *declared* property whose truth lives in each surface's executor switch,
so the two can drift. Mitigations, in order of what they buy:

- A registry test asserting the flag appears only on viewport targets, and that
  the flagged set is exactly these four — so widening it is a deliberate edit
  with a test to update, not a passing accident.
- A comment on the CP executor's switch pointing at the flag, next to the
  existing note about why the switch is exhaustive.

A runtime declaration from `registerViewportShortcutExecutor` was considered and
rejected: the importer runs against a file with no canvas necessarily mounted,
and the settings list must answer for every binding at once, so the answer has to
be available statically.

### 2. Generalize "conditional claimant"

The concept already exists — it is just hard-coded to one scope. A `simulator`
claimant is treated as *may not answer*, so it does not make a chord dead:
`conditionalScope` in `findShortcutShadowing` (`shortcuts.ts:926`), the
`simulator` skip in `findChordCoClaimant` (`SettingsModal.tsx:349`), and
`SIMULATOR_SCOPE_SILENCED` / `shadowingWithoutSimulator` in the importer
(`importPlan.ts:376`).

A declining viewport binding is the same thing for the same reason — the chord
may reach you anyway — so replace the scope equality with a predicate over both:
`candidate.scope === 'simulator' || shortcutMayDecline(candidate.id)`. Rename the
importer's two symbols to match what they now mean (`CONDITIONAL_CLAIMANTS_SILENCED`,
`shadowingWithoutConditionalClaimants`).

This is the whole point of doing it here rather than in the two callers: a
declining blocker should be **transparent, not exempt**. Something else is
usually underneath it, and that is what the user needs warning about.

### 3. Drop the scope checks

- `decideCapture` — the refuse branch keeps only `shortcutKeepsDefaultChords`.
  Undo/Redo merge overrides with defaults rather than replacing, so unbinding
  them promises something that cannot happen; that one is real. Nothing else is
  permanently unbindable.
- `isSharedByDesign` — `blocker.scope === 'viewport'` becomes
  `shortcutMayDecline(blockerId)`. The same-upstream clause stays.

### Cases and their expected answers

Written as the acceptance criteria for the tests below.

| Capture | Today | After |
| --- | --- | --- |
| `5` on a CP tool | refused, "already assigned to Zoom Out" | "Unbind Zoom Out?" → assigns; `5` dispatches to the CP tool |
| `Delete` on a CP tool | refused | `viewport.delete` is transparent; the prompt names `edit.delete`, the global binding that actually dies |
| `Escape` / `Shift+S` / `1` / `3` / `4` / `6` on a CP tool | refused | ordinary unbind prompt |
| `Mod+Z` on anything | refused | unchanged — refused |
| a chord only the simulator holds | assigns silently | unchanged |
| a new chord for `viewport.delete` itself, held by a CP tool | unbind prompt | assigns silently — `viewport.delete` declines, so the CP tool still answers |

The last row is the mirror direction and is the one most likely to be missed:
`findChordCoClaimant` must consider whether the *asked* binding declines, not
only the candidates.

The importer must reach the same answers, and its existing "second always-present
claimant behind the first" guard in `offersFor` still applies — an offer that
would not actually rescue the row must stay unadvertised.

### 4. Fix the provenance comment

`shortcuts.ts:314` says the bare 6/5 chords come from the Oriedita layout.
Oriedita ships both actions unbound — `hotkey.properties:160-161` are empty
`creasePatternZoomOutAction=` / `creasePatternZoomInAction=`, and no Java source
hardcodes a `5` handler. They are Ori Studio defaults. The comment is load-bearing
for anyone reasoning about this code, so correct it rather than leave it.

## Affected Areas

- `apps/web/src/keyboard/shortcuts.ts` — `mayDecline` on `ShortcutDefinition`,
  set on the four; `shortcutMayDecline`; the `conditionalScope` generalization in
  `findShortcutShadowing`; the `shortcuts.ts:314` comment.
- `apps/web/src/components/SettingsModal.tsx` — `decideCapture` refuse branch;
  `findChordCoClaimant` exclusion, both directions.
- `apps/web/src/lib/orieditaImport/importPlan.ts` — `isSharedByDesign`; the two
  renamed simulator-silencing symbols.
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — comment on the
  viewport switch tying the executor's conditionals to the flag.
- Tests: `shortcutRegistry.test.ts`, `shortcuts.test.ts`, `SettingsModal.test.tsx`,
  `orieditaImport` plan tests.

No Rust, no wasm, no dispatch-behavior change — this is conflict *classification*
only, so an unmodified keymap must dispatch identically before and after.

## Checklist

### Phase 1 — the property
- [ ] `mayDecline?: true` on `ShortcutDefinition`; set on `viewport.delete` and
      the three `viewport.solveAngles*`; export `shortcutMayDecline`.
- [ ] Registry test: flag only on `target: 'viewport'`, and the flagged set is
      exactly those four.
- [ ] Comment on the CP viewport switch naming the flag as the thing its
      conditionals have to stay in step with.

### Phase 2 — generalize the conditional claimant
- [ ] `findShortcutShadowing`: `conditionalScope` becomes a predicate over
      simulator scope *or* `mayDecline`.
- [ ] `findChordCoClaimant`: same exclusion, and handle the asked binding
      declining (the mirror row in the case table).
- [ ] Importer: rename to `CONDITIONAL_CLAIMANTS_SILENCED` /
      `shadowingWithoutConditionalClaimants` and silence both kinds.
- [ ] Test: a CP binding on `Delete` reads as conditional, not hard-shadowed.

### Phase 3 — drop the scope checks
- [ ] `decideCapture`: refuse branch keeps only `shortcutKeepsDefaultChords`.
- [ ] `isSharedByDesign`: `shortcutMayDecline(blockerId)`.
- [ ] Test every row of the case table, asserting through the real dispatcher and
      not only the store — a binding can be written and dead.
- [ ] Test: import of `makeFlatFoldableAction=pressed 5` offers to evict Zoom Out,
      and capture reaches the same decision about the same chord.
- [ ] Regression: with no overrides, `Delete` still deletes a selected canvas
      object and otherwise falls through to `edit.delete`.

### Phase 4 — finish
- [ ] Correct the `shortcuts.ts:314` provenance comment.
- [ ] `npm run i18n:extract`, translate any changed strings for all 8 locales,
      `npm run i18n:stamp`, `npm run i18n:check`. The refusal message becomes
      unreachable for viewport blockers but stays for Undo/Redo, so check whether
      any string is now orphaned rather than assuming none changed.
- [ ] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`.
- [ ] Browser check: bind `5` to a CP tool, confirm the prompt names Zoom Out,
      confirm `5` draws and `Mod+-` still zooms out.

## Out of scope

- **`viewport.cancel` should probably decline too.** `cancelActiveCpInput` returns
  `void` (`CreasePatternPanel.tsx:2612`) and has paths that do nothing at all — no
  editable CP, or a final line that clears a selection which may already be empty
  — but it has no way to report that, so the executor returns `true`
  unconditionally (`CreasePatternPanel.tsx:2696`) and Escape is always claimed
  while the CP canvas is the editing context. `handleAppKeyDown` asks the runtime
  first and only falls through to the workspace-wide deselect when nothing claimed
  the key (`appKeyboard.ts:34-53`), so that fallthrough is unreachable there.
  The tree canvas already fixed this shape, with a comment explaining why claiming
  Escape unconditionally was wrong (`TreeEditor.tsx:199`). Fixing it would move
  `cancel` into the declining column, but it needs a signature change on
  `cancelActiveCpInput` plus a decision at each of its early returns, and it
  changes Escape's behavior — so it belongs in its own change.
- **Whether bare `5`/`6` should be defaults at all.** Now that they are known not
  to be Oriedita's, dropping them would resolve this particular collision without
  any of the above — but it changes the shipped keymap for everyone, and it would
  leave the other nine chords stuck. Worth deciding separately; this plan assumes
  the defaults stay.

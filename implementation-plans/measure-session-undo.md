# Measure Session Undo

## Goal

While a measure tool is active, **Undo takes back the last reading** and **Redo
puts it back**. Today Undo reaches straight past the reading and mutates the
crease pattern — the readout the user is looking at stays put while geometry
they cannot see changes underneath it. That is the worst possible pairing:
the visible thing is untouched and the invisible thing is destroyed.

Follow-on to `measure-system-redesign.md`, which deliberately shipped V1 with
no deletion model. This adds the one the app already had a verb for.

## Approach

### The rule, in one sentence

> While the measure tool holds readings, Undo takes back the last reading and
> Redo puts it back. The document's own history is untouched until the readings
> run out — and reaching it ends the measure session's redo.

Two properties follow, and both are why the rule is stated this way rather than
as a strict interleaving of readings and edits:

- **Undo is never destructive while a reading is on screen.** The failure mode
  being fixed is Undo silently mutating geometry; the fix must not leave a
  narrow path back to it.
- **Nothing is trapped.** Readings run out, and then Undo means exactly what it
  always meant. A document edit that lands mid-session (a paste, a dropped
  image) costs one extra press to reach, which is recoverable in a way that
  losing a crease is not.

Strict interleaving would need a monotonic sequence shared by the measure stack
and the CP history entries. That is real machinery for a case that requires a
document mutation to arrive while a non-mutating tool is the active one, and it
buys an ordering the user cannot observe: a reading reappearing is not a state
they have to reason about.

### Where the pieces go

The session cannot stay in `CreasePatternPanel`'s `useState`, because three
surfaces have to agree about it and only one of them is that panel:

| Surface | Reads it for |
| --- | --- |
| `historySlice.undo/redo` | whether Undo belongs to the reading or the document |
| `workspaceCapabilities` | whether Edit ▸ Undo and the canvas history pills are enabled |
| `CreasePatternPanel` | what the canvas layer and the context panel draw |

All three read the store, and every route to Undo (Cmd+Z, the Edit menu, the
native macOS menu, the command palette, the history pills) funnels through
`workspace.undo()`. Putting the session in the store is what makes them agree
by construction instead of by three copies of the same predicate.

1. **`cp-workspace/measureSession.ts`** (new, pure, tested). The session model —
   `{ taken, undone }` — and its four transitions. The rule lives here, not in
   the store slice.
2. **`oristudioCpMeasureSession` in `CreasePatternSliceState`**, listed in
   `CP_DOCUMENT_SCOPED_KEYS` so replacing the document clears it as a compile
   error rather than as a remembered `useEffect`. Four actions:
   `takeOristudioCpMeasurement`, `undoOristudioCpMeasurement`,
   `redoOristudioCpMeasurement`, `endOristudioCpMeasureSession`.
3. **`historySlice.undo` / `redo`**: consult the session before the crease-pattern
   branch. Falling through to the document drops the session's redo.
4. **`workspaceCapabilities`**: `edit.undo` / `edit.redo` count the session, and
   name what they would take back when it is non-empty.
5. **`cp-workspace/useCpMeasureSession.ts`** (new hook). The measure tool's state
   leaves the panel whole — readings, hover, the live pick, the pick count, the
   display preferences and the scale they convert against, plus the one effect
   that ends the session when the tool is left. The panel keeps the composition:
   two mounts and the commit arm.
6. **Delete routes through the same stack.** `viewport.delete`'s
   `dropLastMeasurement` and Undo were two ways to remove the same thing; now
   they are one, and Redo brings it back either way.

### Invariant

`taken` is non-empty **only while a measure tool is active**. `useCpMeasureSession`
owns that (the tool-session effect), which is what lets the store decide undo
ownership from the array alone and stay ignorant of tool state.

## Affected Areas

- `apps/web/src/cp-workspace/measureSession.ts` (new) + test
- `apps/web/src/cp-workspace/useCpMeasureSession.ts` (new)
- `apps/web/src/store/workspaceStore/types.ts`
- `apps/web/src/store/workspaceStore/cpDocumentState.ts`
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts`
- `apps/web/src/store/workspaceStore/slices/historySlice.ts`
- `apps/web/src/store/workspaceStore/capabilities.ts`
- `apps/web/src/lib/workspaceCapabilities.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `apps/web/src/components/panels/CpContextToolPanel.tsx` (the tool's own hint
  names Undo, now that Undo is one of the two doors onto a reading)
- `apps/web/eslint.config.js` (panel line cap moves down: 2900 → 2787)
- locale files for the two new capability descriptions and the reworded hint

## Checklist

- [x] `measureSession.ts` with the four transitions, and its unit test
- [x] Store state, document scoping, and the four actions
- [x] `undo` / `redo` consult the session; falling through drops session redo
- [x] Capabilities count the session and describe what they take back
- [x] `useCpMeasureSession` owns the measure state and the session lifetime
- [x] Panel composes the hook; `dropLastMeasurement` routes through session undo
- [x] Store tests: pop, fall-through, redo mirror, document untouched
- [x] Capability test: Undo enabled on readings alone
- [x] i18n extract + check
- [x] lint / typecheck / unit tests
- [x] Browser verification of the measure → Cmd+Z → Cmd+Shift+Z loop

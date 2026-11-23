# Layer order dialog: click to add, Escape clears

## Goal

Make steering a layer order in the Layer order dialog quick:

1. **Escape clears the sentence being built, and never closes the dialog.**
   Cancel and the close button are the ways out, so one stray key never throws
   away the constraints.
2. **Once a subject is picked, a click on one of its faces adds the
   constraint** ("C in front of D"): two clicks per constraint, no Add press.
   **Shift+click** picks faces without adding, for a sentence of several
   objects ("C in front of D, E"), which Add (or a plain click on one more
   face) then adds as one step.

## Approach

**Escape.** `ModalFrame` takes an optional `onEscape` (it is `onClose` unless
given), passed to `useModalDialog`, which keeps owning the key: it still
stands down for a control or an open menu that uses Escape, and still stops
the key reaching the workspace and a command dialog under it. The Layer order
dialog passes the builder's Clear (`sentence_cleared`), and only when there is
something to clear, so Escape on an empty sentence does nothing.

**Click to add, in the model** (pure, `layer-order/model/`):

- `face_picked` gains `adds`: a plain click on a pane. Shift+click and the
  keyboard face menus leave it off and pick as today (toggle an object).
- A plain click on a face the subject can take puts it in the objects and
  asks for the sentence to be added. Objects picked with Shift or from the
  menu stay with it; the object of an earlier plain click that did not add
  (it couldn't fit, or ran out of time) is replaced, so "click D, can't fit,
  click E" tries "C in front of E", not "D, E". A plain click on a face
  already picked keeps it, and adds.
- `clickAdd` on the state is that add's progress: `checking` until the
  sentence's check answers, then `adding` while its commit is in the worker.
  Add runs as soon as the check fits, as a press of Add would, with the
  preview's token, so it searches nothing more. A check that can't fit or runs
  out lets go, and the hint line says why, as it does for Add. Any other edit
  of the sentence lets go of `checking`; `adding` lands whatever happens.
- While a click's add is in flight, the panes' picks and empty-paper clicks
  are ignored, so a quick second click never lands on a sentence about to
  clear (on a large figure a check takes a few hundred ms). Escape and the
  builder's own controls still work.
- Add (the button or a click) still clears the whole sentence when it lands.

**The panes** read Shift from the pointer's own events, in the capture phase
where they already read how a press came, and send it with the pick
(`LayerPaneFacePick.shift`). The dialog's hook turns it into `adds: !shift`.

**The hint line.** "Pick more faces to add them, or a picked face to remove
it" is no longer true: it becomes a line for objects picked with Shift. An Add
in flight says "Adding C in front of D…", rather than the guidance for a
sentence still being built. On a mouse or a trackpad (not a finger, which has
no Shift), the object step's hint adds "Shift-click to pick several" when
there is more than one face to pick; asking to zoom in for the letters comes
first.

**Analytics.** `layer constraint added` gains `added_by` (`click`/`button`),
so we can tell whether people add by clicking or with Add.

## Affected Areas

- `apps/web/src/components/ui/ModalFrame.tsx`: `onEscape`.
- `apps/web/src/components/layer-order/LayerOrderDialogFrame.tsx`,
  `LayerOrderDialog.tsx`: Escape clears the sentence.
- `apps/web/src/layer-order/model/layerOrderSentence.ts`: the plain click's
  pick, objects picked to keep.
- `apps/web/src/layer-order/model/layerOrderState.ts`,
  `layerOrderReducer.ts`: `adds`, `clickAdd`, the add once the check fits.
- `apps/web/src/layer-order/model/layerOrderSelectors.ts`,
  `components/layer-order/layerOrderInspectorCopy.ts`: the hint line.
- `apps/web/src/layer-order/model/layerOrderAnalytics.ts`, `docs/analytics.md`:
  `added_by`.
- `apps/web/src/layer-order/panes/layerPaneInput.ts`,
  `useLayerPanePointer.ts`, `dialog/useLayerOrderDialog.ts`: Shift.
- `apps/web/public/locales/*/dialogs.json`: the changed and new hint strings.

## Checklist

- [x] ModalFrame `onEscape`; the Layer order dialog's Escape clears the sentence
- [x] Sentence model: plain-click pick, objects kept for the next click
- [x] Reducer: `adds`, `clickAdd`, add when the check fits, picks wait meanwhile
- [x] Panes and hook: Shift travels with the pick
- [x] Hint line: Shift-picked objects, an Add in flight, Shift named in the
      object step on a mouse or trackpad
- [x] Analytics `added_by`, docs
- [x] i18n: extract, translate 8 locales, stamp, check
- [x] Tests: sentence, reducer, panes, dialog (Escape, click, Shift+click)
- [x] Lint, typecheck, relevant unit tests
- [x] Browser check on a real figure (headless Chromium: Kabuto, Oriedita's
      `solution_sample_1`); `scripts/layer-order-dialog-check.mjs` now picks
      objects with Shift+click
- [ ] Draft PR

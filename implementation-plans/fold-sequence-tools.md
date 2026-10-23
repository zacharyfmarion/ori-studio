# Fold sequence tools: Unfold to step and Repeat

## Goal

Make **Unfold to step** and **Repeat on the other side** behave like every
other Fold tool (owner request, 2026-10-20): taken in hand from the rail, the
phone's tool sheet, the menus and the header; their options in the tool
window; previewed on the canvas; committed with the window's button or Enter;
put down with Escape. Delete the special UI they use today — the bars over
the column and everything only they used. Import CP stays a modal.

## Approach

- **A rail group of their own, "Sequence"**: both act on the sequence's
  earlier steps (return to one, fold a range of them again) rather than
  folding the paper along a line, and "Steps" is already the header's view.
  Unfold to step keeps its icon (`Undo2`). Repeat takes the diagram's repeat
  arrow, the mark a diagram uses for "repeat behind": the icon it had
  (`RotateCw`) is the Rotate tool's, a different concept on the same rail.
- **Tool state** (`foldToolState`): the tool ids, and what each keeps from
  one use to the next — Unfold's target, Repeat's range start, its last axis
  (by its sheet line) and "Show as individual steps", and a step being rebuilt
  in place. Interaction state, never saved: the project file and its reader
  version do not change. Both are put down after a commit, as Rotate is, and
  give back the tool they were taken up from.
- **Unfold to step** previews like Rotate: its step is built from the target
  and the step on screen (`fold/return/unfoldTool`), the session previews it,
  the canvas shows the landed pose, the window offers only the earlier steps
  of this path that have a state.
- **Repeat**: the window has the range start, the axis select (only the
  verified axes) and the individual-steps switch. It previews as every tool
  does (owner feedback, 2026-10-20: no axes lit, no separate Preview stage):
  as soon as the range and the axis are set — and again, after a short pause
  (`REPEAT_PREPARE_DELAY_MS`), whenever either changes — it prepares the
  repeat (its 5 s limit and Stop unchanged) and the session previews it: the
  folded pane shows the result, and the creases it adds are drawn in the
  diagram pens on both panes, as a pending fold's are. A free line drawn on
  the canvas (Snap to points on or off) is read through the view it was drawn
  on and taken when it is one of the verified axes within Repeat's
  tolerance; otherwise it stays drawn, refused in Repeat's words (with the
  nearest axis offered as a fix when one is close). A layer-order choice
  shows the shared order chooser. One confirm: the window's Repeat, or
  Enter, adds the repeat previewed. Escape stops a preparation, then lets go
  of a line drawn, then puts Repeat down. The default axis is the last one
  chosen or drawn, while it is valid for the range, else the first valid one.
- **Saved steps**: the Step pane keeps a saved Repeat's and Unfold's facts and
  their Update / Rebuild buttons, which now take the tool in hand in rebuild
  mode; the stored ops and their replay do not change.
- **Header**: Unfold to step stays, and a Repeat button joins it, each shown
  pressed while its tool is in hand; Repeat hides where the header is narrow.

## Affected Areas

- `apps/web/src/fold/tools/` (catalog, registry, state, window, rail groups)
- `apps/web/src/fold/return/`, `apps/web/src/fold/repeat/`
- `apps/web/src/fold/canvas/` (preview, state view, verbs, rail hook)
- `apps/web/src/fold/sequence/` (commands, strip, sequence view)
- `apps/web/src/components/fold/` (window renderer, glyphs, header, canvas)
- `apps/web/src/components/panels/FoldPanel.tsx`, `FoldStepPanel.tsx`
- `apps/web/src/keyboard/shortcuts.ts`, `apps/web/src/i18n/shortcutLabels.ts`
- `docs/analytics.md`

## Checklist

- [x] Tool ids, labels, shortcuts and the Sequence rail group
- [x] Tool state: settings, rebuild, put down after commit / Escape
- [x] Unfold to step: step, preview, window, commit, rebuild
- [x] Repeat: range, axes, drawn axis, preview, order choice, save, rebuild
- [x] Canvas: state shown, letters, Escape ladder, Enter
- [x] Repeat previews as other tools do: prepared automatically (debounced),
      result and added creases on the canvas, one confirm, no axes lit
- [x] Menus, step cards, header buttons and the step strip select the tools
- [x] Step pane: saved-step facts route Update / Rebuild into the tools
- [x] Delete the bars, `useFoldToolWindowYields`, their CSS, tests and strings
- [x] Tests, i18n extract/check (with the eight locales), lint, typecheck
- [x] Browser: desktop light and dark, narrow desktop, phone dark (Stop
      during a preparation is covered by `useFoldRepeatTool.wasm.test.tsx`,
      which pauses the engine mid-search; a real range prepares too fast to
      catch it by hand)

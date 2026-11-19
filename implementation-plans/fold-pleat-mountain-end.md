# A pleat whose mountain end moves

## Goal

A pleat through the front layers of a flap hinged above it could not be
made. The Pleat tool always folds the mountain line first and moves the
side that holds the valley line: the end beyond the valley line moves. When
the valley line lies between the mountain line and the flap's hinge, that
end is the hinged one. The engine's flaps on that side are correctly one
flap — front and back layers join at the hinge — so every layer moves and
none can be left out. Swap, which would move the other end, was refused
(`pleat_failed: lines`) for every pair of parallel lines.

The same creases (the valley nearer the hinge, the mountain nearer the free
end) fold the other way round: the valley first, moving the side that holds
the mountain line, then the mountain on the turned-over paper. On that side
the front layers are a flap of their own.

## Approach

- **The op.** `FoldPleatOp` takes an optional `end: 'mountain'`: the end
  beyond the mountain line moves. Absent, the end beyond the valley line
  moves, exactly as before. The seed and `moving` name the moving side of
  the line folded first, which is the valley line's with the mountain end.
  Written only when it is the mountain's; a build before it reads a key it
  does not know and locks the step, as for the swivel's `otherEnd`, so the
  format version stays.
- **The composite** (`pleatEngine.ts`). With the mountain end, the first
  leg is a valley along `second` (its axiom root `secondRoot`), the return
  leg a valley as seen on the turned-over paper along the mountain line's
  image, which makes the mountain on the starting pose. The same placement
  search, the same material check. The picture draws the return line's
  spans as mountains and the arrow from the paper that stays to the end that
  moves.
- **The tool** (`pleatStep.ts`). Swap on a located pleat makes the
  mountain end move: the valley line is located first, its moving side
  toward the mountain line, so the Layers section is the valley line's and
  the top flap there is the default. The drawn lines stay mountain and
  valley. Without Swap nothing changes.
- **Words.** The window's instruction names the end that folds back; the
  step sentence says valley first, then mountain; the `lines` refusal says
  the two lines must be apart, which is all it can mean now.
- **Repeat** carries `end` on the same side. Behind still refuses
  (`repeat_pleat_behind`): it would trade the lines and the end, a change of
  its own.
- **Analytics.** `fold step added` for a pleat says which end moved
  (`pleat_end`: `valley`/`mountain`).

## Affected Areas

- `apps/web/src/fold/document/foldSequenceDocument.ts`, `foldSequenceFile.ts`
- `apps/web/src/fold/tools/pleat/` (engine, step, window, action geometry)
- `apps/web/src/fold/tools/topFlapSeed.ts`, `refusalNotice.ts`
- `apps/web/src/fold/stepSentence.ts`, `fold/sequence/foldSentenceStep.ts`
- `apps/web/src/fold/repeat/repeatOperation.ts`
- `apps/web/src/analytics/`, `docs/analytics.md`
- `apps/web/src/components/fold/canvas/FoldCanvas.tsx` (the window's view)

## Checklist

- [x] `end` on the op, read, written, locked when malformed
- [x] Composite folds the valley first with the mountain end
- [x] Swap locates the valley line first; section and top flap on its side
- [x] Window instruction, step sentence, `lines` refusal words in 8 locales
- [x] Repeat carries `end`; analytics `pleat_end`
- [x] Regression: half-folded square, front layer only, same paper as two plain folds
- [x] Owner's case prepared under ignored `artifacts/`, checked with the dataset checker
- [x] Browser check

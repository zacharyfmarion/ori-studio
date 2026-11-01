import { useMemo } from 'react';
import { cpPatternStrokes, type CpPatternStrokes } from '../../cp-workspace/adapters/cpPatternStrokes';
import { cpCreaseStrokeWidthPx } from '../../cp-workspace/cpSizingScales';
import { DEFAULT_ORISTUDIO_CP_LINE_STYLE } from '../../lib/creasePatternViewport';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { FoldLetter } from '../engine/foldEngineWire';
import { foldLetterLineColor, type FoldCreasePatternLines } from './foldCreasePatternLines';

/**
 * How much wider the instruction is drawn than a crease: the step's own lines
 * (or a previewed fold's) stand out of the pattern they are part of, under
 * the picks and the hover, which are wider still.
 */
export const FOLD_INSTRUCTION_WIDTH_MUL = 2;

/**
 * The crease-pattern pane's strokes, for the renderer's channels: the
 * pattern for the crease channel, the instruction for the preview channel
 * under the tool's feedback, and the line width Edit's view is set to, which
 * a crease is drawn at Edit's crease width over (`cpCreaseStrokeWidthPx`)
 * and the instruction at {@link FOLD_INSTRUCTION_WIDTH_MUL} times that.
 */
export type FoldCreasePatternStrokes = CpPatternStrokes;

/** The instruction's letters, in drawing order: a mountain over a valley where they cross. */
const LETTERS: readonly FoldLetter[] = ['valley', 'mountain'];

/** What the tool's feedback is measured from on a pane with no crease pattern, CSS px: the edge pen's at the default style. */
const OVERLAY_STROKE_CSS = 1.2;

/**
 * The width a Fold pane strokes at in one frame, device px. On the
 * crease-pattern pane it is Edit's crease width over the line width Edit's
 * view is set to (`cpCreaseStrokeWidthPx`, the call Edit's canvas makes), so
 * a crease is as wide as Edit draws it at the same zoom, and the instruction
 * {@link FOLD_INSTRUCTION_WIDTH_MUL} times that. The folded pane draws no
 * creases of its own: the edge pen's, for the tool's feedback.
 */
export function foldPaneStrokeWidthPx(
  creases: FoldCreasePatternStrokes | null,
  frame: { ratio: number; widthBoost: number }
): number {
  return creases ? cpCreaseStrokeWidthPx(creases.lineWidth, frame) : OVERLAY_STROKE_CSS * frame.ratio * frame.widthBoost;
}

/**
 * The crease-pattern pane drawn through Edit's renderer path
 * (`cpPatternStrokes`), in the line style and width the user gave Edit's
 * view — and the instruction as Edit draws a tool's line, each fold in the
 * crease colour its letter makes (`foldLetterLineColor`), wider than the
 * pattern under it ({@link FOLD_INSTRUCTION_WIDTH_MUL}).
 *
 * The inks are the theme's, resolved against `element` and read again when
 * `themeKey` changes; null until there is an element and something to draw.
 */
export function useFoldCreasePatternStrokes(
  lines: FoldCreasePatternLines | null,
  element: Element | null,
  themeKey: string
): FoldCreasePatternStrokes | null {
  const lineStyle = useWorkspaceStore((state) => state.oristudioCpViewport.lineStyle ?? DEFAULT_ORISTUDIO_CP_LINE_STYLE);
  const lineWidth = useWorkspaceStore((state) => state.oristudioCpViewport.lineWidth ?? 1);
  return useMemo(() => {
    if (!element || !lines) return null;
    const groups = LETTERS.map((letter) => ({
      color: foldLetterLineColor(letter),
      segments: lines.instruction.filter((line) => line.letter === letter),
    }));
    return cpPatternStrokes(lines.creases, element, { lineStyle, lineWidth }, { groups, widthMul: FOLD_INSTRUCTION_WIDTH_MUL });
    // The theme is read off the element: its key is what says it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, element, themeKey, lineStyle, lineWidth]);
}

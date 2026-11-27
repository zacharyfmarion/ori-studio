import { useMemo } from 'react';
import type { FoldOverlayMarks } from '../canvas/foldPaneOverlays';
import type { FoldPaneCreaseLine, FoldPendingCreases } from '../canvas/foldPaneScenes';
import { sheetToScene } from '../canvas/foldPicking';
import type { FoldInstructionLine } from '../canvas/foldCreasePatternLines';
import type { FoldCanvasInks } from '../canvas/useFoldCanvasInks';
import type { FoldLetter, FoldScene } from '../engine/foldEngineWire';
import { toPoint } from '../canvas/foldCanvasGeometry';
import { picksPiece } from './creaseCollapsePicks';
import type { FoldCreaseCollapseTool } from './useFoldCreaseCollapseTool';

const OTHER: Readonly<Record<FoldLetter, FoldLetter>> = { mountain: 'valley', valley: 'mountain' };

/** CSS px: the dot on a point where the creases set do not fold. */
const MARKED_RADIUS = 6;

export interface FoldCreaseCollapseMarks {
  /** The creases set, on both panes: the folded pane's in the paper's diagram pens, the crease pattern's in Edit's. */
  pending: FoldPendingCreases | null;
  /** Where the creases set do not fold, on each pane. */
  folded: FoldOverlayMarks | null;
  creasePattern: FoldOverlayMarks | null;
}

const NONE: FoldCreaseCollapseMarks = { pending: null, folded: null, creasePattern: null };

/**
 * What Collapse draws while it is in hand (`implementation-plans/fold-collapse-existing-creases.md`):
 *
 * - **each crease set**, on the folded pane through every face of the paper
 *   shown it lies on — the step, or the Collapse it previews — in the
 *   paper's mountain or valley diagram pen by the letter the viewer sees
 *   (the other where the face shows its back), behind paper in the hidden
 *   pen; an open one in the flat crease's pen. On the crease pattern, in
 *   Edit's crease colour for its letter, an open one in Edit's auxiliary
 *   colour, over the pattern as a tool's line is;
 * - **a point the creases do not fold at**, a dot in the refusal ink on
 *   both panes.
 */
export function useFoldCreaseCollapseMarks(
  collapse: FoldCreaseCollapseTool | null | undefined,
  shown: FoldScene | null,
  inks: FoldCanvasInks | null
): FoldCreaseCollapseMarks {
  const picks = collapse?.picks ?? null;
  const index = collapse?.index ?? null;
  const marked = collapse?.marked ?? null;
  return useMemo(() => {
    if (!picks || !index) return NONE;
    const folded: FoldPaneCreaseLine[] = [];
    const creasePattern: FoldInstructionLine[] = [];
    for (const pick of picks) {
      const piece = index.pieces.findIndex((each) => picksPiece(pick, each));
      if (piece < 0) continue;
      const open = pick.to === 'open';
      const letter: FoldLetter = pick.to === 'open' ? pick.letter : pick.to;
      creasePattern.push({ a: toPoint(pick.a), b: toPoint(pick.b), letter, ...(open ? { open: true as const } : {}) });
      for (const image of index.images) {
        if (image.piece !== piece) continue;
        folded.push({
          line: image.scene,
          letter: image.frontUp ? letter : OTHER[letter],
          ...(image.visible ? {} : { hidden: true as const }),
          ...(open ? { open: true as const } : {}),
        });
      }
    }
    const dots = (place: (p: readonly [number, number]) => { x: number; y: number } | null): FoldOverlayMarks | null => {
      if (!inks || !marked || marked.length === 0) return null;
      return {
        dots: marked.flatMap((p) => {
          const at = place(p);
          return at ? [{ at, radius: MARKED_RADIUS, fill: inks.danger, stroke: inks.overlay.outline }] : [];
        }),
        strokes: [],
      };
    };
    return {
      pending: picks.length > 0 ? { folded, creasePattern, overLanded: true } : null,
      folded: dots((p) => (shown ? sheetToScene(shown, p) : null)),
      creasePattern: dots((p) => toPoint(p)),
    };
  }, [picks, index, marked, shown, inks]);
}

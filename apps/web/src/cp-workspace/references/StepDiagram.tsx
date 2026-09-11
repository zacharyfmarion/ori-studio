import { useMemo } from 'react';
import type { Diagram } from './referenceFinder/solution';
import {
  referenceFinderDiagramToPrimitives,
  type StepDiagramModel,
} from './referenceFinderDiagramToPrimitives';
import { createDiagramRenderContext, diagramPrimitiveShape } from './diagram/DiagramPrimitives';
import { seenFromTheBack } from './diagram/diagramModel';
import type { Rect } from './diagram/labelLayout';
import { createDiagramProjector } from './stepDiagramGeometry';

/**
 * The corners of a card that its own chrome covers, as shares of the viewBox
 * side. No letter goes there.
 *
 * The step number and the badge are DOM elements over the picture rather than
 * part of it (`.references-card__number`: 2 px down, 4 px in, 0.72 rem bold,
 * tabular digits; `.references-card__badge`: 0.62 rem, semibold, uppercase,
 * in the number's place on a card that is not a fold and in the opposite
 * corner on one that is), so the drawing cannot see them and has to be told.
 * Estimated on a 128 px card, whose thumbnail is 118 px after the padding and
 * the border: a bold digit is 6.6 % of the viewBox side wide and starts 3.4 %
 * in; a badge's uppercase letter is 5.9 % and an ideograph 8.4 %; both line
 * boxes run 14 % down.
 */
export const CARD_NUMBER_CORNER = { inset: 0.034, digit: 0.066, slack: 0.02, height: 0.14 } as const;
export const CARD_BADGE_CORNER = { inset: 0.034, letter: 0.059, ideograph: 0.084, slack: 0.02, height: 0.14 } as const;

/** What a card prints over its picture, so the letters can keep off it. */
export interface CardChrome {
  /** The step number, in the top-left corner; null on a card that is not a fold. */
  number: number | null;
  /**
   * The badge: in the top-right corner beside a number, in the number's place
   * without one. Empty when the card has none.
   */
  badge: string;
}

/** Roughly how wide a badge is, as a share of the viewBox side: by its letters. */
function badgeWidth(text: string): number {
  let width = CARD_BADGE_CORNER.inset + CARD_BADGE_CORNER.slack;
  for (const glyph of text) {
    width += /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/u.test(glyph)
      ? CARD_BADGE_CORNER.ideograph
      : CARD_BADGE_CORNER.letter;
  }
  return Math.min(1, width);
}

/** The boxes a card's chrome covers, in viewBox units. */
export function cardChromeRects(size: number, chrome: CardChrome): Rect[] {
  const rects: Rect[] = [];
  if (chrome.number !== null) {
    const digits = String(chrome.number).length;
    rects.push({
      x: 0,
      y: 0,
      width:
        (CARD_NUMBER_CORNER.inset + CARD_NUMBER_CORNER.digit * digits + CARD_NUMBER_CORNER.slack) *
        size,
      height: CARD_NUMBER_CORNER.height * size,
    });
  }
  if (chrome.badge !== '') {
    const width = badgeWidth(chrome.badge) * size;
    rects.push({
      x: chrome.number !== null ? size - width : 0,
      y: 0,
      width,
      height: CARD_BADGE_CORNER.height * size,
    });
  }
  return rects;
}

export type StepDiagramProps = {
  /** The viewBox side; the element itself scales to its box. */
  size?: number;
  className?: string;
  /** Accessible name; the drawing is otherwise decorative. */
  label?: string;
  /**
   * Draw the paper's back, mirrored, as the view beside the strip does. A card
   * for a fold made after a turn-over shows what the folder is looking at.
   */
  mirrored?: boolean;
  /** What the card prints over the picture; the letters keep off it. */
  chrome?: CardChrome;
} & (
  | {
      /** A ReferenceFinder diagram, adapted here. */
      diagram: Diagram;
      primitives?: undefined;
    }
  | {
      /**
       * Primitives built elsewhere — the planner's steps, which ship
       * witnesses rather than diagrams (`plannerStepToPrimitives.ts`).
       */
      primitives: StepDiagramModel | null;
      diagram?: undefined;
    }
);

export function StepDiagram({
  diagram,
  primitives,
  size = 100,
  className,
  label,
  mirrored = false,
  chrome,
}: StepDiagramProps) {
  const model = useMemo<StepDiagramModel | null>(() => {
    if (diagram === undefined) return primitives ?? null;
    try {
      return referenceFinderDiagramToPrimitives(diagram);
    } catch {
      // A diagram the adapter refuses is a wire-shape change; the row keeps its
      // sentence and simply shows no picture rather than a wrong one.
      return null;
    }
  }, [diagram, primitives]);
  const project = useMemo(
    () => createDiagramProjector(model?.sheet ?? { width: 1, height: 1 }, size, mirrored),
    [model, size, mirrored]
  );
  // The list drawn is the list the context is built from: the letters in it
  // are keyed by position.
  const drawn = useMemo(
    () => (model ? (mirrored ? seenFromTheBack(model.primitives) : model.primitives) : null),
    [model, mirrored]
  );
  // Read off the chrome as the two values it is: the strip hands a fresh
  // object per render, and a layout keyed on it would be redone every time.
  const number = chrome?.number ?? null;
  const badge = chrome?.badge ?? '';
  const context = useMemo(
    () =>
      model && drawn
        ? createDiagramRenderContext(drawn, model.sheet, project, {
            bounds: { x: 0, y: 0, width: size, height: size },
            reserved: cardChromeRects(size, { number, badge }),
          })
        : null,
    [model, drawn, project, size, number, badge]
  );

  if (!model || !drawn || !context) {
    return (
      <svg
        className={['step-diagram', 'step-diagram--unavailable', className].filter(Boolean).join(' ')}
        viewBox={project.viewBox}
        role="img"
        aria-label={label}
        data-diagram-error="true"
      />
    );
  }

  return (
    <svg
      className={['step-diagram', className].filter(Boolean).join(' ')}
      viewBox={project.viewBox}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {drawn.map((primitive, index) => diagramPrimitiveShape(primitive, index, context))}
    </svg>
  );
}

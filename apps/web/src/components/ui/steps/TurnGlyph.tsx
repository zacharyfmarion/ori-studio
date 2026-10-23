import { useMemo } from 'react';
import type { TurnKind } from '../../../lib/steps/turn';
import { createDiagramRenderContext, diagramShapes } from '../../../lib/stepDiagram/DiagramPrimitives';
import {
  DIAGRAM_INLINE_TOKENS,
  diagramInlineInk,
  type DiagramInlineInk,
  type DiagramInlineTokens,
} from '../../../lib/stepDiagram/diagramColors';
import { markReach } from '../../../lib/stepDiagram/markReach';
import { createDiagramProjector, type DiagramSheet } from '../../../lib/stepDiagram/stepDiagramGeometry';
import type { StepDiagramPrimitive } from '../../../lib/stepDiagram/stepDiagramModel';
import styles from './TurnGlyph.module.css';

/** The sheet the glyph is measured against: a unit square, so it is drawn at a step card's size. */
const SHEET: DiagramSheet = { width: 1, height: 1 };

/**
 * How much of its frame the glyph takes, across its longer side: as much of
 * the well as a page's glyph takes of the frame it prints on (`turnGlyph.ts`).
 */
const GLYPH_SHARE = 0.6;

/**
 * Every mark in one ink, `currentColor`: no paper to keep it on, so no second
 * copy in the ground's ink, and the colour is whatever the glyph's own rule
 * gives it — the theme's, here.
 */
const ONE_INK: DiagramInlineInk = (() => {
  const tokens = Object.fromEntries(DIAGRAM_INLINE_TOKENS.map((token) => [token, 'currentColor'])) as DiagramInlineTokens;
  return { ...diagramInlineInk(tokens), ground: { arrow: 'currentColor', mark: 'currentColor' } };
})();

/** A turn as the step diagram's primitive draws it: the turn-over glyph, or the rotate one, by a part of a turn or an angle. */
function turnPrimitive(turn: TurnKind): Extract<StepDiagramPrimitive, { kind: 'turn-over' | 'rotate' }> {
  return turn.kind === 'turn-over'
    ? { kind: 'turn-over', at: [0.5, 0.5], axis: turn.axis }
    : { kind: 'rotate', at: [0.5, 0.5], ...turn.rotate };
}

/** The glyph's shapes, and the square frame round its ink that it is shown in. */
function turnDrawing(turn: TurnKind) {
  const primitive = turnPrimitive(turn);
  const project = createDiagramProjector(SHEET);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  markReach(primitive, project, [], (x, y, pad) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  });
  const centre = Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 50, y: 50 };
  const side = Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY) / GLYPH_SHARE : 100;
  const round = (value: number) => Number(value.toFixed(3));
  const viewBox = [centre.x - side / 2, centre.y - side / 2, side, side].map(round).join(' ');
  // No outline: nothing is paper, so the glyph is one copy in one ink.
  const context = createDiagramRenderContext([primitive], SHEET, project, { outline: [], inline: ONE_INK });
  return { viewBox, shapes: diagramShapes([primitive], context) };
}

/**
 * A turn's glyph — turned over, or round — drawn as a step diagram draws it
 * (`lib/stepDiagram`), in the theme's ink: for a surface that shows a turn on
 * its own ground rather than on the paper a page prints (the Diagram's
 * `turnGlyph.ts`). Square, the glyph centred in it.
 *
 * Decorative: the card it is in says what the turn is in words.
 */
export function TurnGlyph({ turn, className }: { turn: TurnKind; className?: string }) {
  const drawing = useMemo(() => turnDrawing(turn), [turn]);
  return (
    <svg
      className={className ? `${styles.glyph} ${className}` : styles.glyph}
      viewBox={drawing.viewBox}
      aria-hidden="true"
      focusable="false"
      data-turn-glyph=""
    >
      {drawing.shapes}
    </svg>
  );
}

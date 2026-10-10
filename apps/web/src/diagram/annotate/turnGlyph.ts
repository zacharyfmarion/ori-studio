/**
 * A turn's glyph (D22), as the annotation of the same kind draws it: the one
 * a page prints in the gutter and a turn's card shows in its well (D24).
 *
 * Pure: no DOM, no store.
 */
import { mmToCssPx } from '../../lib/paper/paperSvg';
import type { DiagramStyle, DiagramTurnKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PictureBox } from '../pictures/paintDiagramStep';
import { SVG_NS } from '../upload/svgSanitize';
import { paintAnnotations, type PaintedAnnotations } from './paintAnnotations';

/** The frame a turn's glyph is drawn on, mm: it prints at its own size, centred on the frame. */
export const TURN_FRAME_MM = 20;

/** The turn as the annotation that draws its glyph, at the centre of its frame. */
export function turnAnnotation(turn: DiagramTurnKind, id = 'turn'): KnownDiagramAnnotation {
  return turn.kind === 'turn-over'
    ? { id, kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5], axis: turn.axis }
    : { id, kind: 'rotate', from: [0.5, 0.5], to: [0.5, 0.5], rotate: turn.rotate };
}

/**
 * Whether a turn's glyph goes the way its row of steps is read: a turn-over
 * side to side, whose arrow leads on to the next step. One turned top to
 * bottom points down whichever way a row runs, and a rotation's sense is
 * what it says.
 */
export function turnFollowsReading(turn: DiagramTurnKind): boolean {
  return turn.kind === 'turn-over' && turn.axis === 'vertical';
}

/**
 * The glyph drawn on `box`, a frame `TURN_FRAME_MM` across in the target's
 * own units. In a row read right to left, a glyph that goes the way of its
 * row is drawn mirrored about the frame's middle, where it is centred, so its
 * arrow leads to the step after it.
 */
export function paintTurnGlyph(
  turn: DiagramTurnKind,
  box: PictureBox,
  style: DiagramStyle,
  id?: string,
  { rightToLeft = false }: { rightToLeft?: boolean } = {}
): PaintedAnnotations | null {
  const glyph = paintAnnotations([turnAnnotation(turn, id)], box, mmToCssPx(TURN_FRAME_MM), style);
  if (!glyph || !rightToLeft || !turnFollowsReading(turn)) return glyph;
  // x to 2m − x, m the frame's middle.
  const across = 2 * box.x + box.width;
  return {
    markup: `<g transform="matrix(-1 0 0 1 ${Number(across.toFixed(4))} 0)">${glyph.markup}</g>`,
    bounds: { ...glyph.bounds, x: across - glyph.bounds.x - glyph.bounds.width },
  };
}

/** The glyph on its frame as one SVG document, in CSS px, for an `<img>`. Null when it draws nothing. */
export function turnGlyphSvg(turn: DiagramTurnKind, style: DiagramStyle): string | null {
  const size = mmToCssPx(TURN_FRAME_MM);
  const glyph = paintTurnGlyph(turn, { x: 0, y: 0, width: size, height: size }, style);
  if (!glyph) return null;
  const side = Math.round(size * 1000) / 1000;
  return `<svg xmlns="${SVG_NS}" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">${glyph.markup}</svg>`;
}

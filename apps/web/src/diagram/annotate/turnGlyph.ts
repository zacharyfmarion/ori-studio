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

/** The glyph drawn on `box`, a frame `TURN_FRAME_MM` across in the target's own units. */
export function paintTurnGlyph(
  turn: DiagramTurnKind,
  box: PictureBox,
  style: DiagramStyle,
  id?: string
): PaintedAnnotations | null {
  return paintAnnotations([turnAnnotation(turn, id)], box, mmToCssPx(TURN_FRAME_MM), style);
}

/** The glyph on its frame as one SVG document, in CSS px, for an `<img>`. Null when it draws nothing. */
export function turnGlyphSvg(turn: DiagramTurnKind, style: DiagramStyle): string | null {
  const size = mmToCssPx(TURN_FRAME_MM);
  const glyph = paintTurnGlyph(turn, { x: 0, y: 0, width: size, height: size }, style);
  if (!glyph) return null;
  const side = Math.round(size * 1000) / 1000;
  return `<svg xmlns="${SVG_NS}" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">${glyph.markup}</svg>`;
}

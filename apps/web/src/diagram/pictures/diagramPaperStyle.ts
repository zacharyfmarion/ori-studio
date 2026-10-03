import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { PAPER_STYLE_FIELDS, getPaperStyleField, type PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import type { DiagramStyle } from '../document/diagramDocument';
import { digest } from './pictureKey';

/** The Diagram's style policy (D9): one style for every step. */
export const DIAGRAM_STYLE_POLICY = PAPER_STYLE_POLICIES['diagram-workspace'];

/**
 * The style a diagram stores, as a whole style: a built-in preset by its id,
 * or the style itself. A user preset or the export slot was resolved when it
 * was chosen, so nothing here depends on the viewer's machine.
 */
export function diagramPaperStyle(style: DiagramStyle): PaperStyle {
  return 'preset' in style ? builtInPaperPreset(style.preset).style : style.style;
}

/** The style as the Diagram's painters draw it: {@link diagramPaperStyle} through its policy. */
export function diagramSurfaceStyle(style: DiagramStyle): PaperStyle {
  return surfacePaperStyle(diagramPaperStyle(style), DIAGRAM_STYLE_POLICY);
}

/**
 * A key that changes exactly when the drawn style does, for the picture
 * cache. Taken over the resolved style rather than the stored form, so a
 * preset and the same style stored whole share their cached pictures.
 */
export function diagramStyleKey(style: DiagramStyle): string {
  const drawn = diagramSurfaceStyle(style);
  return digest(JSON.stringify(PAPER_STYLE_FIELDS.map((field) => getPaperStyleField(drawn, field))));
}

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
 * A folded model's pens: its mountain and valley folds in the edge pen. A
 * fold that has happened is an edge of the paper, not an instruction (D6).
 * A flat capture names its folds edges already; a 3D or a simulated one
 * names them mountain and valley, which in the Diagram style's fold pens
 * drew them at half a flat step's weight. Every folded picture a diagram
 * shows — a card, a page, Pose's live simulator — is drawn in these, so a
 * step reads the same however it was folded (Zach, 2026-10-09).
 */
export function foldedModelPens(style: PaperStyle): PaperStyle {
  return { ...style, mountainFolds: style.edges, valleyFolds: style.edges };
}

/**
 * The style a captured scene is painted with: {@link diagramSurfaceStyle};
 * for a crease pattern, its aux switch on; for a folded model, flat, in 3D
 * or simulated, {@link foldedModelPens}. A crease pattern's aux lines are the
 * creases already in the paper — drawn whatever the switch says, as
 * References draws the creases earlier steps made — where a folded model's
 * are the style's to show or hide.
 */
export function diagramScenePaintStyle(style: DiagramStyle, pattern: boolean): PaperStyle {
  const painted = diagramSurfaceStyle(style);
  return pattern ? { ...painted, auxCreases: { ...painted.auxCreases, visible: true } } : foldedModelPens(painted);
}

/**
 * A key that changes exactly when the drawn style does, for the picture
 * cache. Taken over the resolved style rather than the stored form, so a
 * preset and the same style stored whole share their cached pictures.
 */
export function diagramStyleKey(style: DiagramStyle): string {
  let key = styleKeys.get(style);
  if (key === undefined) {
    const drawn = diagramSurfaceStyle(style);
    key = digest(JSON.stringify(PAPER_STYLE_FIELDS.map((field) => getPaperStyleField(drawn, field))));
    styleKeys.set(style, key);
  }
  return key;
}

/** Keys by style object: a diagram's style is replaced, never edited, and every card asks. */
const styleKeys = new WeakMap<DiagramStyle, string>();

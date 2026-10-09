import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { PAPER_STYLE_FIELDS, getPaperStyleField, type PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import type { DiagramCpRender, DiagramStyle } from '../document/diagramDocument';
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
 * What a captured scene draws, for the pens it is painted in: a crease
 * pattern, a folded model — flat or in 3D — or a simulation.
 */
export type DiagramSceneDrawn = 'pattern' | 'folded' | 'simulated';

/** What a linked step's render captures: a scene with no render to say is a crease pattern's. */
export function sceneDrawnOf(render: DiagramCpRender | null | undefined): DiagramSceneDrawn {
  switch (render?.mode) {
    case 'folded-flat':
    case 'folded-3d':
      return 'folded';
    case 'simulated':
      return 'simulated';
    default:
      return 'pattern';
  }
}

/**
 * The style a captured scene is painted with: {@link diagramSurfaceStyle};
 * for a crease pattern, its aux switch on; for a folded model, its folds in
 * the edge pen. A crease pattern's aux lines are the creases already in the
 * paper — drawn whatever the switch says, as References draws the creases
 * earlier steps made — where a folded model's are the style's to show or
 * hide. A fold that has happened is an edge of the paper, not an instruction
 * (D6): a flat capture names its folds edges already; a 3D one names them
 * mountain and valley, which Edit's 3D window and Pose's draw in the edge pen,
 * so here too — or a 3D step would print at the fold pens' weight, half the
 * flat steps' in the Diagram style. A simulation draws mountain and valley
 * unless the style says `foldsAsEdges`.
 */
export function diagramScenePaintStyle(style: DiagramStyle, drawn: DiagramSceneDrawn): PaperStyle {
  const painted = diagramSurfaceStyle(style);
  switch (drawn) {
    case 'pattern':
      return { ...painted, auxCreases: { ...painted.auxCreases, visible: true } };
    case 'folded':
      return { ...painted, mountainFolds: painted.edges, valleyFolds: painted.edges };
    case 'simulated':
      return painted;
  }
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

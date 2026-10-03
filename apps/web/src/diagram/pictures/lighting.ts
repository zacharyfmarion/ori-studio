/**
 * Whether a captured picture is still drawn as the diagram's style draws (D5).
 *
 * - A 3D capture bakes its light into every face's shade, so it shows the light
 *   of the style it was captured under: a change of the diagram's light or
 *   widest pen needs it captured again, not re-inked.
 * - A capture too detailed to keep as vector is kept as a bitmap in the pens
 *   of its day: any change of the drawn style needs it captured again.
 *
 * Pure.
 */
import { folded3dSceneStyleKey } from '../../cp-workspace/folded/folded3dScene';
import type { DiagramStep, DiagramStyle } from '../document/diagramDocument';
import { diagramPaperStyle, diagramStyleKey } from './diagramPaperStyle';

const keys = new WeakMap<DiagramStyle, string>();

/** The light key a 3D capture under `style` carries. */
function lightKey(style: DiagramStyle): string {
  let key = keys.get(style);
  if (key === undefined) {
    key = folded3dSceneStyleKey(diagramPaperStyle(style));
    keys.set(style, key);
  }
  return key;
}

/**
 * What of the diagram's style a captured picture no longer shows: its `light`
 * (a 3D scene), its whole `style` (a bitmap), or null when it shows it all.
 */
export function capturedStyleChange(step: DiagramStep, style: DiagramStyle): 'light' | 'style' | null {
  const picture = step.picture;
  if (picture?.kind === 'scene') {
    return picture.styleKey !== null && picture.styleKey !== lightKey(style) ? 'light' : null;
  }
  if (picture?.kind === 'asset' && picture.styleKey !== undefined) {
    return picture.styleKey !== diagramStyleKey(style) ? 'style' : null;
  }
  return null;
}

/** A capture the diagram's style has changed under: Refresh draws it again. */
export function lightingChanged(step: DiagramStep, style: DiagramStyle): boolean {
  return capturedStyleChange(step, style) !== null;
}

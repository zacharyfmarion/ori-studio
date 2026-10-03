/**
 * Whether a 3D step's light is the diagram's (D5). A 3D capture bakes its
 * light into every face's shade, so it is drawn in the light of the style it
 * was captured under; when the diagram's light or widest pen changes, the
 * picture needs capturing again, not re-inking.
 *
 * Pure.
 */
import { folded3dSceneStyleKey } from '../../cp-workspace/folded/folded3dScene';
import type { DiagramStep, DiagramStyle } from '../document/diagramDocument';
import { diagramPaperStyle } from './diagramPaperStyle';

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

/** A 3D capture whose light was baked under another style than the diagram's now. */
export function lightingChanged(step: DiagramStep, style: DiagramStyle): boolean {
  const picture = step.picture;
  return picture?.kind === 'scene' && picture.styleKey !== null && picture.styleKey !== lightKey(style);
}

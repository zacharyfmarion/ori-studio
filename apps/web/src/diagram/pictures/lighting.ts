/**
 * Whether a captured picture is still drawn as the diagram's style draws (D5).
 *
 * - A 3D or simulated capture bakes its light into every face's shade, so it
 *   shows the light of the style it was captured under: a change of the
 *   diagram's light or widest pen needs it captured again, not re-inked. Each
 *   kind records its own key — the folded figure's, or the simulator's, whose
 *   policies differ — and is compared with its own.
 * - A capture too detailed to keep as vector is kept as a bitmap in the pens
 *   of its day: any change of the drawn style needs it captured again.
 *
 * Pure.
 */
import { folded3dSceneStyleKey } from '../../cp-workspace/folded/folded3dScene';
import { simulatorSceneStyleKey } from '../../simulator/simulatorExportTarget';
import { isLockedStep, type DiagramStep, type DiagramStyle } from '../document/diagramDocument';
import { diagramPaperStyle, diagramStyleKey } from './diagramPaperStyle';

const keys = new WeakMap<DiagramStyle, { folded3d: string; simulated: string }>();

/** The light key a 3D or a simulated capture under `style` carries. */
function lightKey(style: DiagramStyle, simulated: boolean): string {
  let key = keys.get(style);
  if (key === undefined) {
    const drawn = diagramPaperStyle(style);
    key = { folded3d: folded3dSceneStyleKey(drawn), simulated: simulatorSceneStyleKey(drawn) };
    keys.set(style, key);
  }
  return simulated ? key.simulated : key.folded3d;
}

/**
 * What of the diagram's style a captured picture no longer shows: its `light`
 * (a 3D scene), its whole `style` (a bitmap), or null when it shows it all.
 */
export function capturedStyleChange(step: DiagramStep, style: DiagramStyle): 'light' | 'style' | null {
  // A newer build's step is never captured again here, so there is no Refresh to ask for.
  if (isLockedStep(step)) return null;
  const picture = step.picture;
  if (picture?.kind === 'scene') {
    const simulated = step.source?.kind === 'cp' && step.source.render.mode === 'simulated';
    return picture.styleKey !== null && picture.styleKey !== lightKey(style, simulated) ? 'light' : null;
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

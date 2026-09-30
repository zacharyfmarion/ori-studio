/**
 * A simulation's view as the export dialog's target: the frame the worker
 * froze when the dialog opened (`beginExportSnapshot`), and the scenes it
 * builds of it.
 *
 * The scene bakes in the style's light and its widest pen (the hidden test's
 * ink allowance) and the hidden test itself, so those rebuild it — a worker
 * round trip — and every other option only repaints the scene in hand. The
 * Simulate view and an inline window share it: the inline-simulation policy
 * applies the same fields as the simulator's, so one policy draws both.
 */
import type { PaperExportSurface } from '../analytics';
import type { PaperStyle, PaperStyleOverrides } from '../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../lib/paper/paperStyleResolve';
import { widestPenCssPx } from '../lib/paper/paperSvg';
import type { PaperExportTarget } from '../paperExport/paperExportTarget';
import type { SimulatorExportSnapshot } from './useSimulatorRuntime';

/** The style as the simulator draws it: its policy's fields, the rest at their defaults. */
function simulatorStyle(style: PaperStyle): PaperStyle {
  return surfacePaperStyle(style, PAPER_STYLE_POLICIES.simulator);
}

/** What of a style a simulation's scene is built with: the light, and the widest pen. */
export function simulatorSceneStyleKey(style: PaperStyle): string {
  const { enabled, azimuth, elevation } = simulatorStyle(style).light;
  return `${enabled}|${azimuth}|${elevation}|${widestPenCssPx(simulatorStyle(style))}`;
}

export interface SimulatorExportCapture {
  snapshot: SimulatorExportSnapshot;
  surface: Extract<PaperExportSurface, 'simulator' | 'inline-simulation'>;
  title: string;
  fileStem: string;
  /** The Settings export style with the object's own pins on top. */
  exportStyle: PaperStyle;
  pins: PaperStyleOverrides | null;
}

export function simulatorExportTarget({
  snapshot,
  surface,
  title,
  fileStem,
  exportStyle,
  pins,
}: SimulatorExportCapture): PaperExportTarget {
  return {
    surface,
    title,
    fileStem,
    pages: null,
    exportStyle,
    pins,
    // The model as it stands, not the unfolded sheet, which a folding model
    // only is at the very start.
    sizeMeasures: 'figure',
    buriesFaces: true,
    sceneKey: ({ style, markHidden }) => `${simulatorSceneStyleKey(style)}|${markHidden}`,
    buildScene: ({ style, markHidden }) => snapshot.scene({ style, markHidden }),
    paintStyle: simulatorStyle,
    release: snapshot.release,
  };
}

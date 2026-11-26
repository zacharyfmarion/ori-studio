/**
 * Pictures painted as the app paints them, for the diagram corpus. Test-only.
 *
 * - {@link repaintStep}: a step's stored picture as Export picture… writes it
 *   (`stepPictureSource`, then `paintSource` at the export's 5 mm), and an
 *   enlarged step's window as it exports (`zoomedPictureFile`). Painting is
 *   pure, so two runs of one checkout agree; two checkouts differ only where
 *   their painters do.
 * - {@link sideBySide}: two captures of one step on one projection, over the
 *   union of their bounds, by this checkout's painter, for the report. A
 *   picture alone is scaled to fit its own bounds, so two captures painted
 *   apart would not line up.
 */
import type { PaperScene } from '@treemaker/origami-simulator';
import { DEFAULT_PAPER_PAGE } from '../../lib/paper/paperPage';
import { pageMarginPt, pagePtPerPx, paperSceneSvgBody } from '../../lib/paper/paperSvg';
import type { DiagramDocument, DiagramScenePicture, DiagramStep, DiagramStyle } from '../document/diagramDocument';
import { diagramScenePaintStyle } from '../pictures/diagramPaperStyle';
import { paintSource, sceneMeasure, stepPictureSource, stepScenePage } from '../pictures/paintDiagramStep';
import { paintedScene } from '../pictures/storedScene';
import { zoomedPictureFile, zoomedSource } from '../zoom/paintZoomed';

/** Export picture's padding. */
const EXPORT_PADDING_MM = DEFAULT_PAPER_PAGE.paddingMm;

export interface Repainted {
  /** Null for a step with no picture this build can draw. */
  svg: string | null;
  /** An enlarged step's window, as it exports. */
  zoomed: string | null;
}

/** A step's stored picture, painted as Export picture… writes it. */
export function repaintStep(step: DiagramStep, diagram: DiagramDocument): Repainted {
  const source = stepPictureSource(step, diagram.assets);
  const zoomed = zoomedSource(step, diagram.assets);
  return {
    svg: source ? (paintSource(source, diagram.style, EXPORT_PADDING_MM)?.svg ?? null) : null,
    zoomed: zoomed ? zoomedPictureFile(zoomed, diagram.style, EXPORT_PADDING_MM) : null,
  };
}

/** How a render is painted: a crease pattern measured by its sheet, a fold by its figure; a simulated scene's lines reordered. */
export function paintingOf(render: string | null): { pattern: boolean; simulated: boolean } {
  return { pattern: render === null || render === 'crease-pattern', simulated: render === 'simulated' };
}

function asPicture(sceneJson: string): DiagramScenePicture {
  return { kind: 'scene', sceneJson, paperScale: null, styleKey: null, key: 'corpus-report' };
}

/** Two captures of one step, painted on one projection: either may be missing. */
export function sideBySide(
  before: string | null,
  after: string | null,
  style: DiagramStyle,
  render: string | null
): [string | null, string | null] {
  const { pattern, simulated } = paintingOf(render);
  const scenes = [before, after].map((json) => (json ? paintedScene(asPicture(json), simulated) : null));
  const reference = scenes[0] ?? scenes[1];
  if (!reference) return [null, null];
  const page = stepScenePage(EXPORT_PADDING_MM);
  const pen = diagramScenePaintStyle(style, pattern);
  // One scale for both: the earlier picture's, as Export picture would size it.
  const ptPerPx = pagePtPerPx(reference, page, sceneMeasure(pattern));
  const margin = pageMarginPt(pen, page);
  const present = scenes.filter((scene): scene is PaperScene => scene !== null);
  const minX = Math.min(...present.map((scene) => scene.bounds.minX));
  const minY = Math.min(...present.map((scene) => scene.bounds.minY));
  const maxX = Math.max(...present.map((scene) => scene.bounds.maxX));
  const maxY = Math.max(...present.map((scene) => scene.bounds.maxY));
  const width = (maxX - minX) * ptPerPx + margin * 2;
  const height = (maxY - minY) * ptPerPx + margin * 2;
  const document = (scene: PaperScene) =>
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}pt" height="${height.toFixed(2)}pt" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">`,
      '  <g stroke-linejoin="round">',
      paperSceneSvgBody(scene, pen, {
        project: ([x, y]) => [(x - minX) * ptPerPx + margin, (y - minY) * ptPerPx + margin],
        unitsPerPt: 1,
        keepHiddenFaces: false,
      }),
      '  </g>',
      '</svg>',
    ].join('\n');
  return [scenes[0] ? document(scenes[0]) : null, scenes[1] ? document(scenes[1]) : null];
}

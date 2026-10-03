import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import {
  createStep,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramFixedPicture,
  type DiagramScenePicture,
  type DiagramStep,
} from './diagramDocument';
import { storedSceneJson } from './diagramFile';

/**
 * Hand-built linked steps for the Diagram's tests: a crease-pattern source
 * and the pictures a capture makes, without a kernel. A `.fixtures.ts` module
 * so the file, painter and card tests read the same steps.
 */

/** A unit square's rim, in pattern units. */
const SQUARE_RIM = [
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
];

export function cpSource(render: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 }): DiagramCpSource {
  return {
    kind: 'cp',
    scope: {
      kind: 'segment',
      region: { boundary: SQUARE_RIM, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, segmentIdHint: 0 },
    },
    fingerprint: 'fp-1',
    thumbnail: {
      viewBox: '0 0 100 100',
      strokes: [
        { x1: 0, y1: 0, x2: 100, y2: 0, role: 'edge' },
        { x1: 0, y1: 50, x2: 100, y2: 50, role: 'mountain' },
      ],
    },
    render,
  };
}

/** A sheet with one crease across it, as a step stores it. */
export function scenePicture(key = 'scene-1'): DiagramScenePicture {
  const sceneJson = storedSceneJson(sheetWithCrease())!;
  return { kind: 'scene', sceneJson, paperScale: 100, styleKey: null, key };
}

export const FIXED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10">' +
  '<path d="M0 0L20 10" stroke="#000"/></svg>';

export function fixedPicture(key = 'fixed-1', svg = FIXED_SVG): DiagramFixedPicture {
  return { kind: 'fixed', svg, widthPx: 20, heightPx: 10, key };
}

/** A linked step: a crease-pattern source and, by default, its captured scene. */
export function cpStep(
  id: string,
  render?: DiagramCpRender,
  picture: DiagramStep['picture'] = scenePicture()
): DiagramStep {
  return { ...createStep(() => id), source: cpSource(render), picture };
}

import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import {
  createStep,
  isTurn,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramEntry,
  type DiagramFixedPicture,
  type DiagramReferencesSource,
  type DiagramScenePicture,
  type DiagramStep,
  type DiagramStepDiagramPicture,
} from './diagramDocument';
import { storedSceneJson } from './diagramFile';

/**
 * Hand-built linked steps for the Diagram's tests: a crease-pattern source
 * and the pictures a capture makes, without a kernel. A `.fixtures.ts` module
 * so the file, painter and card tests read the same steps.
 */

/**
 * A test diagram's entries as steps: the diagrams these tests build hold no
 * turn between steps (D22), and one that does is a test written against the
 * wrong document.
 */
export function stepsIn(document: { steps: readonly DiagramEntry[] }): DiagramStep[] {
  return document.steps.map((entry) => {
    if (isTurn(entry)) throw new Error(`a turn where a step was expected: ${entry.id}`);
    return entry;
  });
}

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

/** A card's picture: a valley across a unit sheet, its arrow and a letter. */
export const SENT_MODEL: StepDiagramModel = {
  sheet: { width: 1, height: 1 },
  primitives: [
    { kind: 'sheet', width: 1, height: 1 },
    { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'valley' },
    { kind: 'fold-arrow', out: { center: [0.5, 0.5], radius: 0.3, from: 0.4, to: 1.4, ccw: true } },
    { kind: 'label', at: [0, 0.5], text: 'A', style: 'normal' },
  ],
};

/** Where a sequence card came from: the unit square's sheet. */
export function referencesSource(patch: Partial<DiagramReferencesSource> = {}): DiagramReferencesSource {
  const { scope, thumbnail } = cpSource();
  if (scope.kind !== 'segment') throw new Error('a region');
  return {
    kind: 'references-step',
    region: scope.region,
    fingerprint: 'fp-sheet',
    thumbnail,
    mode: 'sequence',
    settings: { precreaseGrid: true, gridWhereNeeded: true, allowDanglingFolds: true, mergeSymmetricSteps: true },
    card: 2,
    line: { n: [0, 1], d: 0.5 },
    side: 'front',
    ...patch,
  };
}

export function stepDiagramPicture(mirrored = false, model = SENT_MODEL): DiagramStepDiagramPicture {
  return { kind: 'step-diagram', model, mirrored, key: mirrored ? 'steps-1-back' : 'steps-1' };
}

/** A step sent from References: its card's picture and sentence. */
export function referencesStep(id: string, patch: Partial<DiagramReferencesSource> = {}): DiagramStep {
  return {
    ...createStep(() => id),
    source: referencesSource(patch),
    picture: stepDiagramPicture(patch.side === 'back'),
    text: 'Fold the bottom edge to the top.',
  };
}

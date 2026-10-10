import type { PaperItem } from '../../lib/paper/paperScene';
import { face, line, sceneOf, SQUARE } from '../../lib/paper/paperScene.fixtures';
import type {
  DiagramAsset,
  DiagramCpRender,
  DiagramStep,
  KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { storedSceneJson } from '../document/diagramFile';
import { cpStep } from '../document/diagramSteps.fixtures';
import type { PicturePoint } from './annotationModel';

/**
 * Hand-built steps for the snapping and right-angle tests: a scene picture of
 * a few items, captured as a crease pattern, a flat fold or in 3D, and an
 * upload. A `.fixtures.ts` module so both tests read the same steps.
 */

export const PATTERN: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 };
export const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
export const IN_3D: DiagramCpRender = {
  mode: 'folded-3d',
  side: 'front',
  camera: { yaw: 0.4, pitch: -0.5, zoom: 1 },
};

export const NO_ASSETS: Readonly<Record<string, DiagramAsset>> = {};

/**
 * A step whose picture is these items, captured as `render`. The fixture
 * sheet is 100 px across, so a scene px is a hundredth of a picture unit when
 * the items fill it. A picture taken through a camera carries no paper scale,
 * as a capture's does not.
 */
export function sceneStep(items: PaperItem[], render: DiagramCpRender = PATTERN): DiagramStep {
  const sceneJson = storedSceneJson(sceneOf(items));
  if (sceneJson === null) throw new Error('a scene the file refuses');
  const paperScale = render.mode === 'folded-3d' || render.mode === 'simulated' ? null : 1;
  return cpStep('step-scene', render, { kind: 'scene', sceneJson, paperScale, styleKey: null, key: 'scene-test' });
}

/**
 * The crane's step 8, as far as a right angle there goes: a valley across the
 * centre line, square to it at `at`, and a flap's corners on the valley
 * 0.0075 either side of the crossing (about 3.8 px at fit), each where a
 * flap's edge leaves the valley at a slant, so neither has a right angle.
 */
export const STACKED_CROSSING: { step: DiagramStep; at: PicturePoint; flaps: readonly [PicturePoint, PicturePoint] } = {
  step: sceneStep([
    face([SQUARE]),
    line('diagram-valley', [50, 0], [50, 100]),
    line('diagram-valley', [0, 29.6], [100, 29.6]),
    line('edge', [50.75, 29.6], [70, 0]),
    line('edge', [49.25, 29.6], [30, 0]),
  ]),
  at: [0.5, 0.296],
  flaps: [
    [0.5075, 0.296],
    [0.4925, 0.296],
  ],
};

const UPLOAD_ASSET: DiagramAsset = {
  id: 'asset-upload',
  kind: 'svg',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
  widthPx: 100,
  heightPx: 100,
  bytes: 70,
};

/** An uploaded picture, and the assets it is drawn from. */
export function uploadStep(): { step: DiagramStep; assets: Readonly<Record<string, DiagramAsset>> } {
  return {
    step: {
      ...sceneStep([]),
      source: { kind: 'upload', assetId: UPLOAD_ASSET.id, rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId: UPLOAD_ASSET.id, paperScale: null, key: UPLOAD_ASSET.id },
    },
    assets: { [UPLOAD_ASSET.id]: UPLOAD_ASSET },
  };
}

/** An annotation of a kind, its id named after the kind unless given. */
export function annotation(
  patch: Partial<KnownDiagramAnnotation> & Pick<KnownDiagramAnnotation, 'kind'>
): KnownDiagramAnnotation {
  return { id: `annotation-${patch.kind}`, from: [0, 0], to: [0, 0], ...patch };
}

import { describe, expect, it, vi } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import {
  createStep,
  DEFAULT_DIAGRAM_STYLE,
  type DiagramCpRender,
  type DiagramCpScope,
  type DiagramStep,
} from '../document/diagramDocument';
import { cpStep, scenePicture } from '../document/diagramSteps.fixtures';
import {
  cpDocument,
  fakeCaptureRuntime,
  halfFoldOnSheetKernelScene,
  TWO_SQUARES,
  twoSquaresSegmentation,
  type FixtureLine,
} from './capture.fixtures';
import { captureStep } from './captureFolded';
import { lacksPaperFaces, stepWithPaperFaces } from './stepPaperFaces';

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const scope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };
const FLAT: Extract<DiagramCpRender, { mode: 'folded-flat' }> = {
  mode: 'folded-flat',
  side: 'front',
  rotationDeg: 30,
  foldCase: 1,
  spread: { kind: 'depth', amount: 0.05, toward: 'down' },
};

/** The half fold on its sheet, as the kernel stand-in folds the left square. */
const runtime = () => fakeCaptureRuntime({ paperScene: vi.fn(async () => halfFoldOnSheetKernelScene()) });

/** The left square's diagonal turned valley: the step's link reads stale. */
const edited = () =>
  cpDocument(TWO_SQUARES.map((line, i): FixtureLine => (i === 7 ? ([...line.slice(0, 4), 'Blue2'] as FixtureLine) : line)));

/**
 * A flat step as this build captures it — with its faces — and the same step
 * as a build before them kept it: the same picture, no faces.
 */
async function captured(render: DiagramCpRender = FLAT): Promise<{ now: DiagramStep; older: DiagramStep }> {
  const result = await captureStep(runtime(), {
    document: cpDocument(),
    segmentation,
    scope,
    render,
    style: DEFAULT_DIAGRAM_STYLE,
  });
  if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('expected a picture');
  const picture = result.captured.picture;
  if (picture.kind !== 'scene' || picture.paperFaces === undefined) throw new Error('expected a scene with faces');
  const now: DiagramStep = { ...createStep(() => 'step-1'), source: result.source, picture };
  const { paperFaces: _faces, ...without } = picture;
  return { now, older: { ...now, picture: without } };
}

const request = (step: DiagramStep, patch: Partial<Parameters<typeof stepWithPaperFaces>[1]> = {}) => ({
  step,
  document: cpDocument(),
  segmentation,
  style: DEFAULT_DIAGRAM_STYLE,
  ...patch,
});

describe('a flat step captured before its faces were kept (Revision 2)', () => {
  it('is told apart from one that has them, and from pictures that have none to keep', async () => {
    const { now, older } = await captured();
    expect(lacksPaperFaces(older)).toBe(true);
    expect(lacksPaperFaces(now)).toBe(false);
    expect(lacksPaperFaces(cpStep('cp', { mode: 'crease-pattern', rotationDeg: 0 }))).toBe(false);
    expect(lacksPaperFaces({ ...older, picture: { kind: 'fixed', svg: '<svg/>', widthPx: 1, heightPx: 1, key: 'fixed-1' } })).toBe(false);
    expect(lacksPaperFaces({ ...older, unknown: {} })).toBe(false);
  });

  it('gets them from its pattern folded again while its link is current: the faces a capture keeps, the picture as it was', async () => {
    const { now, older } = await captured();
    const kernel = runtime();
    const result = await stepWithPaperFaces(kernel, request(older));
    expect(kernel.fold).toHaveBeenCalledOnce();
    expect(kernel.free).toHaveBeenCalledWith(7);
    expect(result).toEqual({ status: 'faces', step: now });
    // Nothing else of the step changed: its revision, marks and key stand.
    if (result.status !== 'faces') throw new Error('faces');
    expect(result.step.revision).toBe(older.revision);
    expect(result.step.picture?.key).toBe(older.picture?.key);
  });

  it('works for a pose with no spread, where the stored scene leaves the buried face out', async () => {
    const { spread: _spread, ...unspread } = FLAT;
    const { now, older } = await captured(unspread);
    expect(await stepWithPaperFaces(runtime(), request(older))).toEqual({ status: 'faces', step: now });
  });

  it('folds nothing for a step that has them, or could have none', async () => {
    const { now, older } = await captured();
    const kernel = runtime();
    expect(await stepWithPaperFaces(kernel, request(now))).toEqual({ status: 'faces', step: now });
    expect(await stepWithPaperFaces(kernel, request(cpStep('cp', { mode: 'crease-pattern', rotationDeg: 0 })))).toEqual({
      status: 'none',
    });
    const fixed = { ...older, picture: { kind: 'fixed' as const, svg: '<svg/>', widthPx: 1, heightPx: 1, key: 'fixed-1' } };
    expect(await stepWithPaperFaces(kernel, request(fixed))).toEqual({ status: 'none' });
    expect(kernel.fold).not.toHaveBeenCalled();
  });

  it('sends a step whose link is not current to Refresh, folding nothing', async () => {
    const { older } = await captured();
    const kernel = runtime();
    expect(await stepWithPaperFaces(kernel, request(older, { document: edited() }))).toEqual({
      status: 'refresh',
      why: 'stale',
    });
    expect(await stepWithPaperFaces(kernel, request(older, { segmentation: twoSquaresSegmentation({ wall: false }) }))).toEqual({
      status: 'refresh',
      why: 'missing',
    });
    expect(await stepWithPaperFaces(kernel, request(older, { document: null }))).toEqual({ status: 'refresh', why: 'unknown' });
    expect(await stepWithPaperFaces(kernel, request(older, { segmentation: null }))).toEqual({ status: 'refresh', why: 'unknown' });
    expect(kernel.fold).not.toHaveBeenCalled();
  });

  // The link reads current, but the fold draws another picture than the one
  // stored — a build that folds or draws differently: faces of that picture
  // would not be the stored one's.
  it('sends a step to Refresh when its fold draws another picture now', async () => {
    const { older } = await captured();
    const drawnElsewhere = { ...older, picture: { ...scenePicture('scene-other'), paperScale: 4 } };
    expect(await stepWithPaperFaces(runtime(), request(drawnElsewhere))).toEqual({ status: 'refresh', why: 'redrawn' });
  });
});

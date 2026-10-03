import { describe, expect, it } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import {
  annotationsOutOfStep,
  createDiagram,
  createStep,
  DEFAULT_DIAGRAM_STYLE,
  insertSteps,
  setLinkedPicture,
  type DiagramCpRender,
  type DiagramCpScope,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramScenePicture,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { storedScene } from '../pictures/pictureFrame';
import { cpDocument, fakeCaptureRuntime, movedLines, TWO_SQUARES, twoSquaresSegmentation } from './capture.fixtures';
import { knownCreasesOf } from './captureCreases';
import { captureStep } from './captureFolded';

/**
 * Annotations carried through a linked step's turns, on pictures the capture
 * itself makes (D8): they rest on the turn being about each scene's origin,
 * which `creasePatternScene` and `readFlatPicture` both keep. A capture that
 * turned about anywhere else would leave every carried annotation off its mark.
 */
const segmentation = twoSquaresSegmentation();
// The left square, off the document's middle.
const [left] = resolveCpSegments(segmentation);
const scope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };

async function capture(render: DiagramCpRender) {
  const result = await captureStep(fakeCaptureRuntime(), {
    document: cpDocument(),
    segmentation,
    scope,
    render,
    style: DEFAULT_DIAGRAM_STYLE,
  });
  if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('no picture');
  const picture = result.captured.picture as DiagramScenePicture;
  return { source: result.source, picture };
}

/** A scene point in picture units: the frame is the scene's bounds, its longer side one unit. */
function inPicture(scene: PaperScene, [x, y]: ScenePoint): [number, number] {
  const { bounds } = scene;
  const longer = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return [(x - bounds.minX) / longer, (y - bounds.minY) / longer];
}

/**
 * A point on the paper that is the same in every capture of the scope: the
 * last line's first end, or a flat model's first face's first corner.
 */
function mark(scene: PaperScene): ScenePoint {
  const lines = scene.items.filter((item) => item.kind === 'line');
  const last = lines[lines.length - 1];
  if (last?.kind === 'line') return last.a;
  const face = scene.items.find((item) => item.kind === 'face');
  if (face?.kind !== 'face') throw new Error('nothing to mark');
  return face.rings[0]![0]!;
}

async function annotatedAt(render: DiagramCpRender) {
  const { source, picture } = await capture(render);
  const scene = storedScene(picture)!;
  const at = inPicture(scene, mark(scene));
  const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'push-arrow', from: at, to: [at[0] + 0.1, at[1]] };
  const sign: KnownDiagramAnnotation = { id: 's', kind: 'turn-over', from: at, to: at, axis: 'vertical' };
  const step = { ...createStep(() => 'step-1'), source, picture, annotations: [arrow, sign], annotatedPictureKey: picture.key };
  return insertSteps(createDiagram(), [step], 0);
}

async function turnTo(document: DiagramDocument, render: DiagramCpRender): Promise<DiagramDocument> {
  return setLinkedPicture(document, 'step-1', await capture(render));
}

function expectOnMark(document: DiagramDocument) {
  const step = document.steps[0]!;
  const scene = storedScene(step.picture as DiagramScenePicture)!;
  const [x, y] = inPicture(scene, mark(scene));
  const arrow = step.annotations[0] as KnownDiagramAnnotation;
  // To the stored scene's quantum: a capture keeps its coordinates to 0.01 px.
  expect(arrow.from[0]).toBeCloseTo(x, 4);
  expect(arrow.from[1]).toBeCloseTo(y, 4);
  expect(annotationsOutOfStep(step)).toBe(false);
}

const axis = (document: DiagramDocument) => (document.steps[0]!.annotations[1] as KnownDiagramAnnotation).axis;

describe('annotations on a linked crease pattern, turned', () => {
  it('stay on their crease at every 15° press, and come back with Reset', async () => {
    let document = await annotatedAt({ mode: 'crease-pattern', rotationDeg: 0 });
    for (let degrees = 15; degrees <= 90; degrees += 15) {
      document = await turnTo(document, { mode: 'crease-pattern', rotationDeg: degrees });
      expectOnMark(document);
    }
    // A quarter turn, made of six presses: the turn-over's axis turned once.
    expect(axis(document)).toBe('horizontal');
    document = await turnTo(document, { mode: 'crease-pattern', rotationDeg: 0 });
    expectOnMark(document);
    expect(axis(document)).toBe('vertical');
  });

  it('carry across the wrap from 345° to 0° as one more press', async () => {
    let document = await annotatedAt({ mode: 'crease-pattern', rotationDeg: 345 });
    document = await turnTo(document, { mode: 'crease-pattern', rotationDeg: 0 });
    expectOnMark(document);
    expect(axis(document)).toBe('vertical');
  });
});

describe('annotations on a linked flat model, turned', () => {
  const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };

  it('stay on their crease when the flat model turns', async () => {
    let document = await annotatedAt(FLAT);
    document = await turnTo(document, { ...FLAT, rotationDeg: 30 });
    expectOnMark(document);
  });

  it('stay where they were, out of step, on the other side or another layer order', async () => {
    const document = await annotatedAt(FLAT);
    for (const render of [{ ...FLAT, side: 'back' as const, rotationDeg: 30 }, { ...FLAT, foldCase: 2, rotationDeg: 30 }]) {
      const step = (await turnTo(document, render)).steps[0]!;
      expect(step.annotations).toBe(document.steps[0]!.annotations);
      expect(annotationsOutOfStep(step)).toBe(true);
    }
  });
});

// The pattern dragged, then the step turned in Pose: the capture finds the
// moved sheet and follows it, and the turn is still a turn of the same picture.
describe('annotations on a linked crease pattern, after its pattern moved', () => {
  it('stay on their crease when the moved sheet is turned, as the link follows it', async () => {
    const document = await annotatedAt({ mode: 'crease-pattern', rotationDeg: 0 });
    const source = document.steps[0]!.source as DiagramCpSource;
    const [dx, dy] = [312.7, -88.1];
    const result = await captureStep(fakeCaptureRuntime(), {
      document: cpDocument(movedLines(TWO_SQUARES, dx, dy)),
      segmentation: twoSquaresSegmentation({ dx, dy }),
      scope: source.scope,
      known: knownCreasesOf(source),
      render: { mode: 'crease-pattern', rotationDeg: 30 },
      style: DEFAULT_DIAGRAM_STYLE,
    });
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('no picture');
    expect(result.source.scope).not.toEqual(source.scope);
    const turned = setLinkedPicture(document, 'step-1', {
      source: result.source,
      picture: result.captured.picture as DiagramScenePicture,
    });
    expectOnMark(turned);
  });
});

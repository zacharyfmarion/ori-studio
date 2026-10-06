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
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { storedScene } from '../pictures/pictureFrame';
import { cpDocument, fakeCaptureRuntime, movedLines, TWO_SQUARES, twoSquaresSegmentation } from './capture.fixtures';
import { knownCreasesOf } from './captureCreases';
import { captureStep } from './captureFolded';
import { stepsIn } from '../document/diagramSteps.fixtures';

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
  const step = stepsIn(document)[0]!;
  const scene = storedScene(step.picture as DiagramScenePicture)!;
  const [x, y] = inPicture(scene, mark(scene));
  const arrow = step.annotations[0] as KnownDiagramAnnotation;
  // To the stored scene's quantum: a capture keeps its coordinates to 0.01 px.
  expect(arrow.from[0]).toBeCloseTo(x, 4);
  expect(arrow.from[1]).toBeCloseTo(y, 4);
  expect(annotationsOutOfStep(step)).toBe(false);
}

const axis = (document: DiagramDocument) => (stepsIn(document)[0]!.annotations[1] as KnownDiagramAnnotation).axis;

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

// Zach, 2026-10-06: "I wanted to just change the color of the face and not flip the creases."
describe('annotations on a linked crease pattern, its paper the back colour', () => {
  const PATTERN = { mode: 'crease-pattern' as const, rotationDeg: 0 };
  const BACK = { ...PATTERN, side: 'back' as const };

  it('stay exactly where they were, Front to Back and back again, and in step with the new picture', async () => {
    for (const rotationDeg of [0, 30, 90, 157.5]) {
      const front = await annotatedAt({ ...PATTERN, rotationDeg });
      const back = await turnTo(front, { ...BACK, rotationDeg });
      const step = stepsIn(back)[0]!;
      expect(step.source).toMatchObject({ render: { mode: 'crease-pattern', rotationDeg, side: 'back' } });
      // Another picture — the other colour — with the marks on it untouched.
      expect(step.picture!.key).not.toBe(stepsIn(front)[0]!.picture!.key);
      expect(step.annotations).toEqual(stepsIn(front)[0]!.annotations);
      expectOnMark(back);
      const again = await turnTo(back, { ...PATTERN, rotationDeg });
      expect(stepsIn(again)[0]!.annotations).toEqual(stepsIn(front)[0]!.annotations);
      expectOnMark(again);
    }
  });

  it('keep their arcs as they were: nothing is mirrored', async () => {
    const front = await annotatedAt(PATTERN);
    const step = stepsIn(front)[0]!;
    const fold: KnownDiagramAnnotation = { id: 'f', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.6, 0.5], bend: 0.3 };
    const marked = insertSteps(createDiagram(), [{ ...step, annotations: [fold] }], 0);
    const back = await turnTo(marked, BACK);
    expect(stepsIn(back)[0]!.annotations).toEqual([fold]);
  });

  it('come back from the file as they were, the paper still its back color', async () => {
    const front = await annotatedAt(PATTERN);
    const back = await turnTo(front, BACK);
    const read = stepsIn(readDiagram(JSON.parse(JSON.stringify(writeDiagram(back))))!.document)[0]!;
    expect(read.source).toMatchObject({ render: BACK });
    expect(read.picture).toEqual(stepsIn(back)[0]!.picture);
    expect(storedScene(read.picture as DiagramScenePicture)!.items[0]).toMatchObject({ kind: 'face', side: 'back' });
    expect(read.annotations).toEqual(stepsIn(front)[0]!.annotations);
    expect(annotationsOutOfStep(read)).toBe(false);
  });

  it('turn with a back as with a front', async () => {
    let document = await annotatedAt(BACK);
    document = await turnTo(document, { ...BACK, rotationDeg: 45 });
    expectOnMark(document);
    // Recoloured and turned at once: no verb does both, but the carry is still the turn's.
    document = await turnTo(document, { ...PATTERN, rotationDeg: 120 });
    expectOnMark(document);
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
      const step = stepsIn((await turnTo(document, render)))[0]!;
      expect(step.annotations).toBe(stepsIn(document)[0]!.annotations);
      expect(annotationsOutOfStep(step)).toBe(true);
    }
  });
});

// The pattern dragged, then the step turned in Pose: the capture finds the
// moved sheet and follows it, and the turn is still a turn of the same picture.
describe('annotations on a linked crease pattern, after its pattern moved', () => {
  it('stay on their crease when the moved sheet is turned, as the link follows it', async () => {
    const document = await annotatedAt({ mode: 'crease-pattern', rotationDeg: 0 });
    const source = stepsIn(document)[0]!.source as DiagramCpSource;
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

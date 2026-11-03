import { describe, expect, it } from 'vitest';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import { halfFoldOnSheetKernelScene } from '../capture/capture.fixtures';
import { flatScenePicture } from '../capture/captureFolded';
import {
  createDiagram,
  DEFAULT_AFFINE_SPREAD,
  insertSteps,
  setLinkedPicture,
  type DiagramCpRender,
  type DiagramIdFactory,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { cpSource, cpStep, fixedPicture, stepsIn } from '../document/diagramSteps.fixtures';
import { paperFacesOf } from '../zoom/zoomImprint';
import { defoxFoldLineMarks } from './defoxFoldLines';

/**
 * The half fold of `halfFoldOnSheetKernelScene` as Defox saves it: its unit
 * sheet folded along y = ½, far half up over the near one, with a crease at
 * x = ¼ the step makes through both layers — valley on the near half and
 * mountain on the far one on the paper's front, so a valley through the pair
 * as they lie.
 */
function snapshot(lines: readonly (readonly [number, number, string])[], V: number[][] = [[0.25, 0], [0.25, 0.5], [0.25, 1], [0, 0], [1, 1]]): string {
  return JSON.stringify({
    fold: { V, UV: lines.map(([a, b]) => [a, b]), UA: lines.map(([, , assign]) => assign) },
  });
}
const NEAR_VALLEY = [0, 1, 'MM'] as const;
const FAR_MOUNTAIN = [1, 2, 'VV'] as const;

function ids(): DiagramIdFactory {
  let next = 0;
  return (prefix) => `${prefix}-${(next += 1)}`;
}

/** The half fold captured flat, as Show as Folded leaves the step: its faces on the paper. */
function captured(render: Extract<DiagramCpRender, { mode: 'folded-flat' }>, farOnTop = false): DiagramStep {
  const kernel = halfFoldOnSheetKernelScene();
  const scene = farOnTop
    ? { ...kernel, subfaces: kernel.subfaces.map((subface) => ({ ...subface, faces_top_to_bottom: [1, 0] })) }
    : kernel;
  const picture = flatScenePicture(scene, render.rotationDeg, render.spread);
  if (picture.kind !== 'picture') throw new Error('a stored scene');
  return cpStep('step-1', render, picture.picture);
}

const FLAT: Extract<DiagramCpRender, { mode: 'folded-flat' }> = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };

/** A mark's ends on the picture, as the paper's frame names them. */
function ends(mark: KnownDiagramAnnotation): number[] {
  return [...mark.from, ...mark.to].map((n) => Math.round(n * 1000) / 1000);
}

describe('a saved Defox view’s fold lines on the capture that replaces it', () => {
  it('draws a crease through the layers once, where the top layer shows it, named as seen', () => {
    const marks = defoxFoldLineMarks(snapshot([NEAR_VALLEY, FAR_MOUNTAIN]), captured(FLAT), ids());
    expect(marks.map((mark) => mark.kind)).toEqual(['valley-line']);
    // Across the folded model, ¼ of the way along: 100 wide and 50 tall, its longer side one unit.
    expect(ends(marks[0]!)).toEqual([0.25, 0, 0.25, 0.5]);
  });

  it('leaves out a crease on a buried layer alone', () => {
    expect(defoxFoldLineMarks(snapshot([FAR_MOUNTAIN]), captured(FLAT), ids())).toEqual([]);
  });

  it('names a fold on a face showing its back the other way, and a precrease a valley', () => {
    const onTop = captured(FLAT, true);
    expect(defoxFoldLineMarks(snapshot([[1, 2, 'MM']]), onTop, ids()).map((mark) => mark.kind)).toEqual(['mountain-line']);
    expect(defoxFoldLineMarks(snapshot([FAR_MOUNTAIN]), onTop, ids()).map((mark) => mark.kind)).toEqual(['valley-line']);
    expect(defoxFoldLineMarks(snapshot([[1, 2, 'FF']]), onTop, ids()).map((mark) => mark.kind)).toEqual(['valley-line']);
  });

  it('turns with the picture', () => {
    const [mark] = defoxFoldLineMarks(snapshot([NEAR_VALLEY]), captured({ ...FLAT, rotationDeg: 90 }), ids());
    // A quarter turn clockwise lays the crease across: one height, ¼ of the way down.
    expect(mark!.kind).toBe('valley-line');
    expect(mark!.from[1]).toBeCloseTo(mark!.to[1], 9);
    expect(Math.abs(mark!.to[0] - mark!.from[0])).toBeCloseTo(0.5, 6);
    expect(mark!.from[1]).toBeCloseTo(0.25, 6);
  });

  it('lands where a spread carries a mark drawn on the picture unspread', () => {
    const spread = { ...FLAT, spread: DEFAULT_AFFINE_SPREAD };
    const [direct] = defoxFoldLineMarks(snapshot([NEAR_VALLEY]), captured(spread), ids());
    const flat = captured(FLAT);
    const drawn = { ...flat, annotations: defoxFoldLineMarks(snapshot([NEAR_VALLEY]), flat, ids()), annotatedPictureKey: flat.picture!.key };
    const [carried] = withCarriedAnnotations(drawn, { ...captured(spread), annotations: drawn.annotations }, {}).annotations as KnownDiagramAnnotation[];
    expect(paperFacesOf(captured(spread))?.spread).toBe(true);
    expect(direct!.from[0]).toBeCloseTo(carried!.from[0], 6);
    expect(direct!.from[1]).toBeCloseTo(carried!.from[1], 6);
    expect(direct!.to[0]).toBeCloseTo(carried!.to[0], 6);
    expect(direct!.to[1]).toBeCloseTo(carried!.to[1], 6);
  });

  it('draws a crease the step folds the other way along its edge, named as the face on top sees it', () => {
    // The fold itself, y = ½, refolded: a valley on the paper's front, seen from the near half, on top.
    const refold = JSON.stringify({
      fold: { V: [[0, 0.5], [1, 0.5], [0, 0], [1, 1]], UV: [], UA: [], EV: [[0, 1]], EA: ['RM'] },
    });
    const [mark] = defoxFoldLineMarks(refold, captured(FLAT), ids());
    expect(mark!.kind).toBe('valley-line');
    expect(ends(mark!)).toEqual([0, 0.5, 1, 0.5]);
    // Unfolding it draws no line: that is its arrow's to say.
    const unfold = JSON.stringify({ fold: { V: [[0, 0.5], [1, 0.5], [0, 0], [1, 1]], UV: [], UA: [], EV: [[0, 1]], EA: ['UF'] } });
    expect(defoxFoldLineMarks(unfold, captured(FLAT), ids())).toEqual([]);
  });

  it('brings nothing for a snapshot that does not read, a paper of another shape, or a picture with no faces', () => {
    const step = captured(FLAT);
    expect(defoxFoldLineMarks('{"fold":', step, ids())).toEqual([]);
    expect(defoxFoldLineMarks(snapshot([[0, 9, 'MM']]), step, ids())).toEqual([]);
    expect(defoxFoldLineMarks(snapshot([NEAR_VALLEY], [[0.25, 0], [0.25, 0.5], [0.25, 1], [0, 0], [1, 2]]), step, ids())).toEqual([]);
    expect(defoxFoldLineMarks(snapshot([NEAR_VALLEY]), cpStep('step-2', FLAT, fixedPicture()), ids())).toEqual([]);
  });
});

describe('a capture replacing a saved Defox view (setLinkedPicture)', () => {
  const ARROW: KnownDiagramAnnotation = { id: 'arrow-1', kind: 'valley-arrow', from: [0.2, 0.2], to: [0.6, 0.2], bend: 0.1 };
  const defoxStep = (annotations: KnownDiagramAnnotation[] = []) => {
    const step = cpStep('step-1', { mode: 'defox', snapshot: snapshot([NEAR_VALLEY, FAR_MOUNTAIN]) }, fixedPicture('defox-view'));
    return insertSteps(createDiagram(), [{ ...step, annotations, annotatedPictureKey: 'defox-view' }], 0);
  };
  const replaced = (document: ReturnType<typeof defoxStep>) => {
    const { picture } = captured(FLAT);
    return stepsIn(setLinkedPicture(document, 'step-1', { source: cpSource(FLAT), picture }))[0]!;
  };

  it('keeps the view’s fold lines as the step’s own, in step with the new picture', () => {
    const step = replaced(defoxStep());
    expect(step.annotations.map((mark) => (mark as KnownDiagramAnnotation).kind)).toEqual(['valley-line']);
    expect(step.annotatedPictureKey).toBe(step.picture!.key);
  });

  it('lays them under the author’s marks, which stay out of step as they were', () => {
    const step = replaced(defoxStep([ARROW]));
    expect(step.annotations.map((mark) => (mark as KnownDiagramAnnotation).kind)).toEqual(['valley-line', 'valley-arrow']);
    expect(step.annotatedPictureKey).toBe('defox-view');
  });

  it('brings nothing to a step that showed no Defox view', () => {
    const flat = cpStep('step-1', FLAT, fixedPicture('flat-view'));
    const step = replaced(insertSteps(createDiagram(), [flat], 0));
    expect(step.annotations).toEqual([]);
  });
});

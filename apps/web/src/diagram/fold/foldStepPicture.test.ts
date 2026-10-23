import { describe, expect, it } from 'vitest';

import { FOLD_USER_PER_UNIT } from '../../fold/canvas/foldCanvasGeometry';
import { FOLD_PANE_DISPLAY_DEFAULT, foldedPaneScene } from '../../fold/canvas/foldPaneScenes';
import type { FoldActionGeometry } from '../../fold/engine/foldEngineWire';
import { diagonalHalfScene, squareScene } from '../../fold/sequence/foldScene.fixtures';
import type { PaperLineItem, PaperScene } from '../../lib/paper/paperScene';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import { arrowApex, defaultBend } from '../annotate/annotationModel';
import type {
  DiagramCpRender,
  DiagramIdFactory,
  DiagramScenePicture,
  DiagramStep,
  KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { readPaperFaces } from '../document/paperFacesFile';
import { storedScene } from '../pictures/pictureFrame';
import { flatScenePicture, type CapturedPicture } from '../capture/captureFolded';
import { CAPTURE_PX_PER_UNIT } from '../capture/captureGeometry';
import type { FoldStepAction } from './foldStepMarkPlan';
import { DIAGRAM_PUSH_INK } from '../../lib/stepDiagram/diagramInk';
import { INK_UNITS } from '../annotate/canvasInk';
import {
  FOLD_PUSH_ARROW_LENGTH,
  foldScenePattern,
  foldStepPicture,
  PATTERN_PER_SHEET_UNIT,
  type FoldStepPictureInput,
} from './foldStepPicture';

const SQUARE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

function sequentialIds(): DiagramIdFactory {
  let next = 0;
  return (prefix) => `${prefix}-${(next += 1)}`;
}

/** The diagonal valley fold of the unit square: its line across the square, the top-left corner swung onto the bottom-right. */
const VALLEY: FoldActionGeometry = {
  kind: 'fold',
  direction: 'valley',
  line: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  spans: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, hidden: false }],
  moving: [0],
  grip: { at: { x: 0.25, y: 0.75 }, image: { x: 0.75, y: 0.25 }, hidden_at: 0, hidden_image: 1 },
};

/** Step 1 of a square: the diagonal valley, seen before it folds (the flat sheet) or after. */
function input(moment: 'before' | 'after', action: FoldStepAction | null = VALLEY): FoldStepPictureInput {
  return {
    shown: moment === 'before' ? squareScene() : diagonalHalfScene(),
    own: { scene: diagonalHalfScene(), step: 1, sheet: SQUARE },
    moment,
    action: moment === 'before' ? action : null,
  };
}

const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };

function sceneOf(captured: CapturedPicture): { picture: DiagramScenePicture; scene: PaperScene } {
  if (captured.kind !== 'picture' || captured.picture.kind !== 'scene') throw new Error('a scene picture');
  return { picture: captured.picture, scene: storedScene(captured.picture)! };
}

const lines = (scene: PaperScene) => scene.items.filter((item): item is PaperLineItem => item.kind === 'line');

describe('a Fold step’s picture (D11, D17)', () => {
  it('keeps both pleat line assignments and its editable arrow under back and rotated poses', () => {
    const action: FoldActionGeometry = {
      ...VALLEY, direction: 'mountain', grip: null,
      spans: [
        { from: { x: 0.1, y: 0.6 }, to: { x: 0.9, y: 0.6 }, hidden: false },
        { from: { x: 0.2, y: 0.4 }, to: { x: 0.8, y: 0.4 }, hidden: false, direction: 'valley' },
      ],
      pleat: { from: { x: 0.6, y: 0.7 }, to: { x: 0.6, y: 0.3 }, kinks: 1 },
    };
    for (const side of ['front', 'back'] as const) {
      for (const rotationDeg of [0, 90]) {
        const result = foldStepPicture(input('before', action), { ...FLAT, side, rotationDeg }, sequentialIds());
        expect(result.marks.map((mark) => mark.kind)).toEqual(side === 'front'
          ? ['mountain-line', 'valley-line', 'pleat-arrow'] : ['valley-line', 'mountain-line', 'pleat-arrow']);
        expect(result.marks.every((mark) => mark.imported === 'untouched')).toBe(true);
        const arrow = result.marks[2]!;
        expect(arrow.from[rotationDeg === 0 ? 0 : 1]).toBeCloseTo(arrow.to[rotationDeg === 0 ? 0 : 1]);
      }
    }
  });

  it('draws a push arrow its own short length — about twice its head’s width — its tip where the engine puts it', () => {
    // The engine's push: a long way down onto the middle of the top edge.
    const action: FoldActionGeometry = { ...VALLEY, grip: null, push: { at: { x: 0.5, y: 1.6 }, toward: { x: 0.5, y: 1 } } };
    const [push] = foldStepPicture(input('before', action), FLAT, sequentialIds()).marks.filter((mark) => mark.kind === 'push-arrow');
    if (push?.kind !== 'push-arrow') throw new Error('a push arrow');
    const length = Math.hypot(push.to[0] - push.from[0], push.to[1] - push.from[1]);
    const headWidth = 2 * DIAGRAM_PUSH_INK.headHalf * INK_UNITS;
    expect(length).toBeCloseTo(FOLD_PUSH_ARROW_LENGTH, 9);
    expect(length / headWidth).toBeGreaterThanOrEqual(2);
    expect(length / headWidth).toBeLessThanOrEqual(2.5);
    // The tip on the top edge's middle, the arrow coming straight down onto it, as the engine's did.
    expect(push.to[0]).toBeCloseTo(0.5, 9);
    expect(push.to[1]).toBeCloseTo(0, 9);
    expect(push.from[0]).toBeCloseTo(0.5, 9);
    expect(push.from[1]).toBeCloseTo(-FOLD_PUSH_ARROW_LENGTH, 9);
  });

  it('draws its crease pattern before the step with the step’s creases as its instruction, and after it as folds', () => {
    const before = sceneOf(foldStepPicture(input('before'), { mode: 'crease-pattern', rotationDeg: 0 }).captured).scene;
    expect(lines(before).map((line) => line.role).sort()).toEqual(['diagram-valley', 'edge', 'edge', 'edge', 'edge']);
    const after = sceneOf(foldStepPicture(input('after'), { mode: 'crease-pattern', rotationDeg: 0 }).captured).scene;
    expect(lines(after).map((line) => line.role)).toContain('valley');
    expect(lines(after).map((line) => line.role)).not.toContain('diagram-valley');
  });

  it('draws the sheet the size Edit draws its paper, about its middle, turned, on the side’s colour', () => {
    const { picture, scene } = sceneOf(
      foldStepPicture(input('after'), { mode: 'crease-pattern', rotationDeg: 90, side: 'back' }).captured
    );
    const span = scene.bounds.maxX - scene.bounds.minX;
    expect(span / picture.paperScale!).toBeCloseTo(PATTERN_PER_SHEET_UNIT, 6);
    expect(scene.bounds.minX).toBeCloseTo(-scene.bounds.maxX, 6);
    expect(scene.items.find((item) => item.kind === 'face')).toMatchObject({ side: 'back' });
  });

  it('turns its crease pattern over with Flip creases on the back: mirrored side to side, mountains and valleys swapped', () => {
    const back: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0, side: 'back' };
    const flip: DiagramCpRender = { ...back, flipCreases: true };
    const instruction = (scene: PaperScene) => lines(scene).find((line) => line.role.startsWith('diagram-'))!;
    const plain = instruction(sceneOf(foldStepPicture(input('before'), back).captured).scene);
    const flipped = instruction(sceneOf(foldStepPicture(input('before'), flip).captured).scene);
    expect(plain.role).toBe('diagram-valley');
    expect(flipped.role).toBe('diagram-mountain');
    // The diagonal, mirrored about the sheet's vertical middle: the other diagonal.
    for (const end of ['a', 'b'] as const) {
      expect(flipped[end][0]).toBeCloseTo(-plain[end][0], 6);
      expect(flipped[end][1]).toBeCloseTo(plain[end][1], 6);
    }
    expect(plain.a[0] * plain.a[1]).not.toBeCloseTo(0, 6);
    // After the step, its fold the other way, and the paper still on the back's colour.
    const after = sceneOf(foldStepPicture(input('after'), flip).captured).scene;
    expect(lines(after).map((line) => line.role)).toContain('mountain');
    expect(lines(after).map((line) => line.role)).not.toContain('valley');
    expect(after.items.find((item) => item.kind === 'face')).toMatchObject({ side: 'back' });
    // Kept on the front, where it draws nothing.
    const front: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 };
    expect(sceneOf(foldStepPicture(input('before'), { ...front, flipCreases: true }).captured).scene).toEqual(
      sceneOf(foldStepPicture(input('before'), front).captured).scene
    );
  });

  it('draws the state it shows folded, with its faces on the paper for an enlarged step to anchor to', () => {
    const { picture, scene } = sceneOf(foldStepPicture(input('after'), FLAT).captured);
    expect(scene.items.some((item) => item.kind === 'face')).toBe(true);
    const faces = readPaperFaces(picture.paperFaces);
    expect(faces && typeof faces !== 'symbol' ? faces.faces.rings.length : 0).toBe(2);
  });

  it('draws only the stretches of a fold’s line the viewer sees, none under a layer that stays', () => {
    const action: FoldActionGeometry = {
      ...VALLEY,
      spans: [
        { from: { x: 0, y: 0 }, to: { x: 0.5, y: 0.5 }, hidden: false },
        { from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 1 }, hidden: true },
      ],
    };
    const marks = foldStepPicture(input('before', action), FLAT, sequentialIds()).marks;
    expect(marks.map((mark) => mark.kind)).toEqual(['valley-line', 'valley-arrow']);
    // Every stretch hidden: no line at all, the arrow alone.
    const covered = { ...action, spans: action.spans.map((span) => ({ ...span, hidden: true })) };
    expect(foldStepPicture(input('before', covered), FLAT, sequentialIds()).marks.map((mark) => mark.kind)).toEqual(['valley-arrow']);
  });

  it('brings the fold’s line and arrow, tagged as the source’s, before a fold — and none after it', () => {
    const before = foldStepPicture(input('before'), FLAT, sequentialIds());
    expect(before.marks.map((mark) => mark.kind)).toEqual(['valley-line', 'valley-arrow']);
    expect(before.marks.every((mark) => mark.imported === 'untouched')).toBe(true);
    // Its tip lands under the layer the fold leaves over it.
    expect(before.marks[1]).toMatchObject({ behind: { to: 1 } });
    expect(typeof before.marks[1]!.bend).toBe('number');
    // Every point inside the picture's frame.
    for (const mark of before.marks) {
      for (const [u, v] of [mark.from, mark.to]) {
        expect(u).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(u).toBeLessThanOrEqual(1 + 1e-9);
        expect(v).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    expect(foldStepPicture(input('after'), FLAT).marks).toEqual([]);
    expect(foldStepPicture(input('before'), { mode: 'crease-pattern', rotationDeg: 0 }).marks).toEqual([]);
  });

  it('names the fold from the back on the back, and marks no end behind there', () => {
    const back = foldStepPicture(input('before'), { ...FLAT, side: 'back' }, sequentialIds()).marks;
    expect(back.map((mark) => mark.kind)).toEqual(['mountain-line', 'mountain-arrow']);
    expect(back[1]!.behind).toBeUndefined();
    const front = foldStepPicture(input('before'), FLAT, sequentialIds()).marks;
    // Mirrored left to right: the arrow's tail is on the other side of the picture.
    expect(back[1]!.from[0]).toBeCloseTo(1 - front[1]!.from[0], 6);
  });

  it('draws a precrease’s arrow coming back', () => {
    const precrease = foldStepPicture(input('before', { ...VALLEY, kind: 'precrease' }), FLAT).marks;
    expect(precrease.map((mark) => mark.kind)).toEqual(['valley-line', 'fold-unfold-arrow']);
  });

  it('circles the points the step names with the Diagram’s point circle, dotted under the layers over it', () => {
    const rings = [
      { at: { x: 0, y: 1 }, behind: 0 },
      { at: { x: 1, y: 0 }, behind: 2 },
    ];
    const marks = foldStepPicture(input('before', { ...VALLEY, rings }), FLAT, sequentialIds()).marks;
    expect(marks.map((mark) => mark.kind)).toEqual(['valley-line', 'circle', 'circle', 'valley-arrow']);
    const [first, second] = marks.filter((mark) => mark.kind === 'circle');
    // The fixed-size point marker References' rings lift to: a centre, no radius.
    expect(first).toMatchObject({ from: [0, 0], to: [0, 0], imported: 'untouched' });
    expect(first!.radius).toBeUndefined();
    expect(first!.behind).toBeUndefined();
    expect(second).toMatchObject({ from: [1, 1], behind: { from: 2 } });
    // Seen from the back, no end is marked behind.
    const back = foldStepPicture(input('before', { ...VALLEY, rings }), { ...FLAT, side: 'back' }, sequentialIds()).marks;
    expect(back.filter((mark) => mark.kind === 'circle').every((mark) => mark.behind === undefined)).toBe(true);
  });

  it('bows an arrow along the paper’s edge over the paper, not off it', () => {
    // Along the bottom edge: bowed away from the picture's middle, as a new arrow is, it would leave the paper.
    const alongEdge: FoldActionGeometry = {
      ...VALLEY,
      kind: 'precrease',
      grip: { at: { x: 0.1, y: 0.04 }, image: { x: 0.9, y: 0.04 }, hidden_at: 0, hidden_image: null },
    };
    const arrow = foldStepPicture(input('before', alongEdge), FLAT, sequentialIds()).marks.find((mark) => mark.kind === 'fold-unfold-arrow')!;
    const apex = arrowApex(arrow.from, arrow.to, arrow.bend!);
    expect(apex[1]).toBeLessThan(1);
    expect(apex[1]).toBeLessThan(arrow.from[1]);
    expect(arrow.bend).toBe(-defaultBend(arrow.from, arrow.to, { width: 1, height: 1 }));
  });

  it('draws every crease a Repeat made as its crease pattern’s instruction, not only its last operation’s', () => {
    // Two creases made by a Repeat of two operations: the state before it was step 0.
    const scene = diagonalHalfScene();
    scene.creases = [
      ...scene.creases.filter((crease) => crease.kind === 'border'),
      { id: 4, vertices: [0, 0], from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, kind: 'fold', letter: 'valley', made_at: 1 },
      { id: 5, vertices: [0, 0], from: { x: 0, y: 1 }, to: { x: 1, y: 0 }, kind: 'flat', letter: 'mountain', made_at: 2 },
    ];
    const own = { scene, step: 2, sheet: SQUARE };
    const drawn = (since?: number) =>
      lines(
        sceneOf(
          foldStepPicture({ ...input('before'), own: { ...own, ...(since !== undefined ? { since } : {}) } }, { mode: 'crease-pattern', rotationDeg: 0 })
            .captured
        ).scene
      ).filter((line) => line.role.startsWith('diagram-'));
    expect(drawn(0).map((line) => line.role).sort()).toEqual(['diagram-mountain', 'diagram-valley']);
    // A step of one operation, as before: its own crease alone.
    expect(drawn().map((line) => line.role)).toEqual(['diagram-mountain']);
  });

  it('spreads the state’s layers, and carries the fold’s marks onto them as a spread pose would', () => {
    const layered: FoldStepPictureInput = { ...input('before'), shown: diagonalHalfScene() };
    const spread = { kind: 'depth' as const, amount: 0.2, toward: 'down' as const };
    const flat = foldStepPicture(layered, FLAT, sequentialIds());
    const spreadOut = foldStepPicture(layered, { ...FLAT, spread }, sequentialIds());
    expect(sceneOf(spreadOut.captured).scene).not.toEqual(sceneOf(flat.captured).scene);
    // The same marks, Fold's, each carried with the paper it lies on — as a
    // step pulled unspread and spread in the Diagram afterwards has them.
    expect(spreadOut.marks.map((mark) => [mark.kind, mark.imported])).toEqual(flat.marks.map((mark) => [mark.kind, mark.imported]));
    const step = (render: DiagramCpRender, picture: DiagramScenePicture, annotations: KnownDiagramAnnotation[]): DiagramStep => ({
      id: 'step-a',
      revision: 0,
      source: { kind: 'fold-step', sequence: 'fold-a', step: 'fstep-a', moment: 'before', path: 'fh1:a', state: 'fs1:a', engine: 1, thumbnail: flat.thumbnail, render },
      picture,
      annotations,
      annotatedPictureKey: picture.key,
      text: '',
      breakBefore: false,
    });
    const posed = withCarriedAnnotations(
      step(FLAT, sceneOf(flat.captured).picture, flat.marks),
      step({ ...FLAT, spread }, sceneOf(spreadOut.captured).picture, flat.marks),
      {}
    );
    expect(spreadOut.marks).toEqual(posed.annotations);
    expect(spreadOut.marks).not.toEqual(flat.marks);
  });

  it('draws a state as Fold’s folded pane does with the same spread: one picture, at another scale', () => {
    const spread = { kind: 'affine' as const, amount: 0.2, keep: 'top' as const, skew: 1, axisDeg: 30 };
    const diagram = sceneOf(flatScenePicture(foldScenePattern(diagonalHalfScene(), 'front'), 0, spread)).scene;
    const fold = foldedPaneScene(diagonalHalfScene(), FOLD_PANE_DISPLAY_DEFAULT, undefined, spread);
    const facesOf = (scene: PaperScene, unit: number) =>
      scene.items.flatMap((item) =>
        item.kind === 'face' ? [item.rings[0]!.map(([x, y]) => [x / unit, y / unit] as const)] : []
      );
    const [ours, theirs] = [facesOf(diagram, PATTERN_PER_SHEET_UNIT * CAPTURE_PX_PER_UNIT), facesOf(fold, FOLD_USER_PER_UNIT)];
    expect(ours).toHaveLength(theirs.length);
    ours.forEach((ring, face) =>
      ring.forEach(([x, y], corner) => {
        expect(x).toBeCloseTo(theirs[face]![corner]![0], 3);
        expect(y).toBeCloseTo(theirs[face]![corner]![1], 3);
      })
    );
    // And it is spread: the layer under the top one has moved off where it lies flat.
    const unspread = facesOf(foldedPaneScene(diagonalHalfScene(), FOLD_PANE_DISPLAY_DEFAULT), FOLD_USER_PER_UNIT);
    expect(theirs).not.toEqual(unspread);
  });

  it('keeps the step’s crease pattern as its thumbnail', () => {
    const { thumbnail } = foldStepPicture(input('before'), FLAT);
    expect(thumbnail.strokes.map((stroke) => stroke.role)).toContain('valley');
  });
});

describe('a Fold state as the kernel’s paper scene', () => {
  it('turns over as the kernel’s back pass: mirrored, every stack from the other end, every face’s other side up', () => {
    const front = foldScenePattern(diagonalHalfScene(), 'front');
    const back = foldScenePattern(diagonalHalfScene(), 'back');
    expect(back.subfaces[0]!.faces_top_to_bottom).toEqual([...front.subfaces[0]!.faces_top_to_bottom].reverse());
    expect(back.faces.map((face) => face.front_up)).toEqual(front.faces.map((face) => !face.front_up));
    expect(back.faces[0]!.outline.map((point) => point.x)).toEqual(front.faces[0]!.outline.map((point) => -point.x));
    // The paper is the paper, whichever side shows.
    expect(back.sheet_points).toEqual(front.sheet_points);
    expect(front.sheet).toBe(PATTERN_PER_SHEET_UNIT);
    // y down, as Edit's model is.
    expect(front.sheet_points[3]).toEqual({ x: 0, y: -PATTERN_PER_SHEET_UNIT });
  });
});

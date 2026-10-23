import { describe, expect, it } from 'vitest';
import { paperSceneToFoldedGeometry } from '../../cp-workspace/adapters/cpFoldedToScene';
import type { Point } from '../../lib/geometry';
import type { PaperLineItem } from '../../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { bookScene, flatSquareScene } from './foldCanvas.fixtures';
import { foldOpSteps, type FoldRepeatOp } from '../document/foldSequenceDocument';
import { FOLD_USER_PER_UNIT } from './foldCanvasGeometry';
import {
  creasePatternPaperScene,
  creaseRole,
  FOLD_PANE_DISPLAY_DEFAULT,
  foldedDisplayOffset,
  foldedPaneScene,
  foldFrameSpread,
  foldPaneMark,
  madeByStep,
  withFoldCreases,
  withFoldLine,
  withPreviewCreases,
  type FoldPaneCreaseLine,
  type FoldPanePreviewCreases,
} from './foldPaneScenes';
import { restingSpread } from './useFoldCanvasPaint';

const SQUARE: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const lines = (items: readonly { kind: string }[]) => items.filter((item): item is PaperLineItem => item.kind === 'line');

describe('the Fold panes’ paper scenes', () => {
  it('draws each crease in the pen of what it is, the step’s own as its instruction', () => {
    const [, , , , , , fold] = bookScene().creases;
    if (!fold) throw new Error('no fold');
    const display = FOLD_PANE_DISPLAY_DEFAULT;
    expect(creaseRole(fold, { display, step: 1, instruction: null })).toBe('diagram-valley');
    expect(creaseRole(fold, { display, step: 2, instruction: null })).toBe('valley');
    expect(creaseRole(fold, { display: { ...display, stepCreases: false }, step: 1, instruction: null })).toBe('valley');
    // A previewed fold's added creases are the instruction, in place of the step's own.
    expect(creaseRole(fold, { display, step: 1, instruction: new Set([9]) })).toBe('valley');
    const flat = { ...fold, kind: 'flat' as const, made_at: 0 };
    expect(creaseRole(flat, { display, step: 1, instruction: null })).toBe('aux');
    expect(creaseRole(flat, { display: { ...display, precreases: false }, step: 1, instruction: null })).toBeNull();
  });

  it('draws every crease made since the state a step folds from as its instruction: a Repeat’s every operation’s', () => {
    const [, , , , , , fold] = bookScene().creases;
    if (!fold) throw new Error('no fold');
    const display = FOLD_PANE_DISPLAY_DEFAULT;
    // A Repeat of three operations landed at step 5: what steps 3, 4 and 5 made is its own.
    for (const madeAt of [3, 4, 5]) {
      expect(creaseRole({ ...fold, made_at: madeAt }, { display, step: 5, since: 2, instruction: null })).toBe('diagram-valley');
      expect(foldPaneMark({ from: fold.from, to: fold.to, letter: 'valley', made_at: madeAt, pieces: [] }, { display, step: 5, since: 2, instruction: null })).toEqual({
        as: 'instruction',
        letter: 'valley',
      });
    }
    expect(creaseRole({ ...fold, made_at: 2 }, { display, step: 5, since: 2, instruction: null })).toBe('valley');
    // Unsaid, a step is one operation, as before.
    expect(creaseRole({ ...fold, made_at: 4 }, { display, step: 5, instruction: null })).toBe('valley');
    expect(madeByStep(5, { step: 5 })).toBe(true);
    expect(madeByStep(0, { step: 0, since: -1 })).toBe(false);
    expect(foldOpSteps({ kind: 'valley' })).toBe(1);
    expect(foldOpSteps({ kind: 'repeat', steps: [{}, {}, {}] } as unknown as FoldRepeatOp)).toBe(3);
  });

  it('lays the crease pattern front up, the folds under the border, in user space', () => {
    const scene = creasePatternPaperScene(bookScene(), {
      display: FOLD_PANE_DISPLAY_DEFAULT,
      sheet: SQUARE,
      step: 1,
    });
    expect(scene.items[0]).toMatchObject({ kind: 'face', side: 'front' });
    const roles = lines(scene.items).map((item) => item.role);
    expect(roles.indexOf('diagram-valley')).toBeLessThan(roles.indexOf('edge'));
    expect(roles.filter((role) => role === 'edge')).toHaveLength(6);
    // y down in user space: the sheet's top edge is at −1 unit.
    const { minX, minY, maxX, maxY } = scene.bounds;
    expect([minX, minY, maxX, maxY].map((v) => v + 0)).toEqual([0, -FOLD_USER_PER_UNIT, FOLD_USER_PER_UNIT, 0]);
  });

  it('draws a crease mark in the paper picture of a crease pattern in the aux pen, as a precrease, or as the instruction', () => {
    const scene = {
      ...bookScene(),
      crease_marks: [{ from: { x: 0.75, y: 0.45 }, to: { x: 0.75, y: 0.55 }, letter: 'valley' as const, made_at: 2, pieces: [] }],
    };
    const roles = (step: number) =>
      lines(creasePatternPaperScene(scene, { display: FOLD_PANE_DISPLAY_DEFAULT, sheet: SQUARE, step }).items).map((item) => item.role);
    // The bend is step 1's, the mark step 2's.
    expect(roles(2).filter((role) => role === 'diagram-valley')).toHaveLength(1);
    expect(roles(2)).toContain('valley');
    expect(roles(2)).not.toContain('aux');
    // Context at a later step: the bend by its letter, the mark a flat crease, under the folds.
    expect(roles(3).filter((role) => role === 'valley')).toHaveLength(1);
    expect(roles(3).filter((role) => role === 'aux')).toHaveLength(1);
    expect(roles(3).indexOf('aux')).toBeLessThan(roles(3).indexOf('valley'));
  });

  it('paints the folded form whole faces in painter’s order, a fold line over it in its pen', () => {
    const base = foldedPaneScene(bookScene(), FOLD_PANE_DISPLAY_DEFAULT);
    const faces = base.items.filter((item) => item.kind === 'face');
    // Bottom first: the left half, then the right half over it.
    expect(faces.map((face) => face.kind === 'face' && face.face)).toEqual([0, 1]);
    const lined = withFoldLine(base, [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }], 'mountain', { x: 0.25, y: 0 });
    const [added] = lines(lined.items).slice(-1);
    expect(added?.role).toBe('diagram-mountain');
    // Run past the paper at both ends, and shown at the pane's offset.
    expect(added?.a[0]).toBeLessThan(0.25 * FOLD_USER_PER_UNIT);
    expect(added?.b[0]).toBeGreaterThan(0.75 * FOLD_USER_PER_UNIT);
  });

  it('spreads the folded form’s layers as the step says: the leaf under the book steps out, the top one stays', () => {
    const rings = (scene: ReturnType<typeof foldedPaneScene>) =>
      new Map(scene.items.flatMap((item) => (item.kind === 'face' ? [[item.face, item]] : [])));
    const flat = rings(foldedPaneScene(bookScene(), FOLD_PANE_DISPLAY_DEFAULT));
    const depth = rings(
      foldedPaneScene(bookScene(), FOLD_PANE_DISPLAY_DEFAULT, undefined, { kind: 'depth', amount: 0.1, toward: 'down' })
    );
    // Unspread, the leaf underneath is never seen; spread, it peeks out, so it is drawn.
    expect(flat.get(0)?.hidden).toBe(true);
    expect(depth.get(0)?.hidden).toBe(false);
    // The top leaf's free corner stays; the leaf under it steps down the screen
    // by a tenth of the model's longer side, in user space (the fold, shared,
    // goes half as far, so it stays joined).
    const corner = (faces: typeof flat, face: number, at: number) => faces.get(face)!.rings[0]![at]!;
    expect(corner(depth, 1, 1)[0]).toBeCloseTo(corner(flat, 1, 1)[0], 9);
    expect(corner(depth, 1, 1)[1]).toBeCloseTo(corner(flat, 1, 1)[1], 9);
    expect(corner(depth, 0, 0)[1] - corner(flat, 0, 0)[1]).toBeCloseTo(0.1 * FOLD_USER_PER_UNIT, 9);
    expect(corner(depth, 0, 0)[0]).toBeCloseTo(corner(flat, 0, 0)[0], 9);
    expect(corner(depth, 0, 1)[1] - corner(flat, 0, 1)[1]).toBeCloseTo(0.05 * FOLD_USER_PER_UNIT, 9);

    const affine = rings(
      foldedPaneScene(bookScene(), FOLD_PANE_DISPLAY_DEFAULT, undefined, {
        kind: 'affine',
        amount: 0.1,
        keep: 'top',
        skew: 0,
        axisDeg: 0,
      })
    );
    expect(affine.get(1)?.rings).toEqual(flat.get(1)?.rings);
    expect(affine.get(0)?.rings).not.toEqual(flat.get(0)?.rings);
    // Off is no spread at all: the pane's own picture.
    expect(foldedPaneScene(bookScene(), FOLD_PANE_DISPLAY_DEFAULT, undefined, null)).toEqual(
      foldedPaneScene(bookScene(), FOLD_PANE_DISPLAY_DEFAULT)
    );
  });

  it('spreads the pane at rest, and lays the paper flat once the tools locate a fold on it', () => {
    const spread = { kind: 'depth' as const, amount: 0.05, toward: 'down' as const };
    expect(restingSpread(spread, { action: null, analysis: null })).toBe(spread);
    const analysis = {} as NonNullable<Parameters<typeof restingSpread>[1]['analysis']>;
    const action = {} as NonNullable<Parameters<typeof restingSpread>[1]['action']>;
    expect(restingSpread(spread, { action: null, analysis })).toBeNull();
    expect(restingSpread(spread, { action, analysis: null })).toBeNull();
    expect(restingSpread(null, { action: null, analysis: null })).toBeNull();
  });

  it('names an affine spread’s axis in the engine’s y-up frame, the Diagram’s y-down axis mirrored', () => {
    expect(foldFrameSpread({ kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 })).toMatchObject({ axisDeg: 99 });
    expect(foldFrameSpread({ kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 0 })).toMatchObject({ axisDeg: 0 });
    const depth = { kind: 'depth' as const, amount: 0.03, toward: 'up-left' as const };
    expect(foldFrameSpread(depth)).toBe(depth);
    expect(foldFrameSpread(null)).toBeNull();
  });

  it('turns a turned-over model about the sheet’s middle, never off the camera', () => {
    const turned = { ...flatSquareScene(), view: { flipped: true, rotation: 0 }, view_transform: [-1, 0, 0, 0, 1, 0] as const };
    // The engine's view takes x to −x; shown at an offset of 1, the sheet stays where it was.
    expect(foldedDisplayOffset(turned, SQUARE)).toEqual({ x: 1, y: 0 });
    expect(foldedDisplayOffset(flatSquareScene(), SQUARE)).toEqual({ x: 0, y: 0 });
    const quarter = { ...flatSquareScene(), view_transform: [0, -1, 0, 1, 0, 0] as const };
    const offset = foldedDisplayOffset(quarter, SQUARE);
    // (0.5, 0.5) turns to (−0.5, 0.5): shifted back by one along x.
    expect(offset.x).toBeCloseTo(1, 12);
    expect(offset.y).toBeCloseTo(0, 12);
  });
});

describe('a tool’s preview on the folded pane, every crease in the diagram-crease pen of its letter', () => {
  const base = () => foldedPaneScene(flatSquareScene(), FOLD_PANE_DISPLAY_DEFAULT);
  const across: [Point, Point] = [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
  ];
  const upright: [Point, Point] = [
    { x: 0.5, y: 0 },
    { x: 0.5, y: 1 },
  ];
  /** The lines the preview added over the paper's own, by role. */
  const added = (preview: FoldPanePreviewCreases) => {
    const before = lines(base().items).length;
    return lines(withPreviewCreases(base(), preview).items)
      .slice(before)
      .map((item) => item.role);
  };
  const none = { second: null, vertex: null };

  it('draws a valley fold’s, a mountain fold’s and a precrease’s line — its extent, for part of a line — by its direction', () => {
    expect(added({ action: { line: across, direction: 'valley' }, ...none })).toEqual(['diagram-valley']);
    expect(added({ action: { line: across, direction: 'mountain' }, ...none })).toEqual(['diagram-mountain']);
    // A precrease is drawn by the way it folds; a pinch's line is the pinch.
    const pinch: [Point, Point] = [
      { x: 0.5, y: 0.47 },
      { x: 0.5, y: 0.53 },
    ];
    expect(added({ action: { line: pinch, direction: 'mountain' }, ...none })).toEqual(['diagram-mountain']);
  });

  it('draws a reverse fold’s, a sink’s and a tuck’s picture by the direction it shows the viewer', () => {
    // The compound line folds' pictures are one line each, lettered by the engine as the viewer sees it.
    for (const direction of ['valley', 'mountain'] as const) {
      expect(added({ action: { line: across, direction }, ...none })).toEqual([`diagram-${direction}`]);
    }
  });

  it('draws a crimp’s two lines, the second the other way', () => {
    expect(added({ action: { line: across, direction: 'valley' }, second: upright, vertex: null })).toEqual([
      'diagram-valley',
      'diagram-mountain',
    ]);
    expect(added({ action: { line: across, direction: 'mountain' }, second: upright, vertex: null })).toEqual([
      'diagram-mountain',
      'diagram-valley',
    ]);
  });

  it('draws a vertex fold’s creases by their own letters, not its action’s one line across the paper', () => {
    const vertex: FoldPaneCreaseLine[] = [
      { line: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }], letter: 'valley' },
      { line: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }], letter: 'mountain' },
    ];
    expect(added({ action: { line: across, direction: 'valley' }, second: null, vertex })).toEqual([
      'diagram-valley',
      'diagram-mountain',
    ]);
    // Run as given, from the vertex: no overhang past it.
    const [ray] = lines(withPreviewCreases(base(), { action: null, second: null, vertex }).items).slice(-2);
    expect(ray?.a).toEqual([0.5 * FOLD_USER_PER_UNIT, -0.5 * FOLD_USER_PER_UNIT]);
    // Before the engine describes it, nothing: never the action's line in its place.
    expect(added({ action: { line: across, direction: 'valley' }, second: null, vertex: [] })).toEqual([]);
  });

  it('draws a fan’s given creases pending, in their pen, until the engine’s own take their place', () => {
    const pending: FoldPaneCreaseLine[] = [
      { line: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }], letter: 'mountain' },
      { line: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }], letter: 'mountain' },
      { line: [{ x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }], letter: 'mountain' },
    ];
    const pens = ['diagram-mountain', 'diagram-mountain', 'diagram-mountain'];
    // From the clicks on, before the tool asks the engine, and while its answer is on the way.
    expect(added({ action: null, second: null, vertex: null, pending })).toEqual(pens);
    expect(added({ action: null, second: null, vertex: [], pending })).toEqual(pens);
    // Run as given, from the center: a crease stops where the paper does.
    const [first] = lines(withPreviewCreases(base(), { action: null, second: null, vertex: [], pending }).items).slice(-3);
    expect(first?.a).toEqual([0.5 * FOLD_USER_PER_UNIT, -0.5 * FOLD_USER_PER_UNIT]);
    expect(first?.b).toEqual([FOLD_USER_PER_UNIT, -0.5 * FOLD_USER_PER_UNIT]);
    // Described: the engine's creases, the fourth among them, and the pending ones no longer.
    const vertex: FoldPaneCreaseLine[] = [...pending, { line: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0 }], letter: 'valley' }];
    expect(added({ action: { line: across, direction: 'mountain' }, second: null, vertex, pending })).toEqual([
      ...pens,
      'diagram-valley',
    ]);
  });

  it('leaves the paper as it is while nothing is located', () => {
    expect(added({ action: null, ...none })).toEqual([]);
    expect(withFoldCreases(base(), [])).toEqual(base());
  });

  it('draws a crease behind the paper in the diagram’s hidden-line pen, dotted, whatever its letter', () => {
    const behind: FoldPaneCreaseLine[] = [
      { line: [{ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.1 }], letter: 'valley', hidden: true },
      { line: [{ x: 0.5, y: 0.5 }, { x: 0, y: 0.2 }], letter: 'mountain' },
    ];
    expect(added({ action: null, second: null, vertex: behind })).toEqual(['diagram-hidden', 'diagram-mountain']);
  });

  it('strokes each in the user’s own mountain and valley diagram crease pens, not the fold pens', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      valleyDiagramCreases: { width: 2.2, color: '#00ff00', dash: [4, 2], cap: 'butt' },
      mountainDiagramCreases: { width: 1.7, color: '#ff00ff', dash: [8, 2, 1, 2], cap: 'butt' },
    };
    const scene = withPreviewCreases(
      { bounds: { minX: 0, minY: -FOLD_USER_PER_UNIT, maxX: FOLD_USER_PER_UNIT, maxY: 0 }, sheet: FOLD_USER_PER_UNIT, items: [] },
      { action: { line: across, direction: 'valley' }, second: upright, vertex: null }
    );
    const drawn = paperSceneToFoldedGeometry(scene, style, { policy: PAPER_STYLE_POLICIES.fold }).strokes;
    expect(drawn.count).toBe(2);
    const color = (k: number) => [...drawn.color.slice(k * 4, k * 4 + 3)];
    expect(color(0)).toEqual([0, 1, 0]);
    expect(drawn.widthMul[0]).toBeCloseTo(2.2, 6);
    expect(color(1)).toEqual([1, 0, 1]);
    expect(drawn.widthMul[1]).toBeCloseTo(1.7, 6);
    // Both dashed, each in its own pattern.
    expect(drawn.dashSlot?.[0]).toBeGreaterThan(0);
    expect(drawn.dashSlot?.[1]).toBeGreaterThan(0);
    expect(drawn.dashSlot?.[0]).not.toBe(drawn.dashSlot?.[1]);
  });
});

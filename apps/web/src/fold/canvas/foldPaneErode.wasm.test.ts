import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTURE_PX_PER_UNIT } from '../../diagram/capture/captureGeometry';
import { flatScenePicture } from '../../diagram/capture/captureFolded';
import { foldScenePattern, PATTERN_PER_SHEET_UNIT } from '../../diagram/fold/foldStepPicture';
import { storedScene } from '../../diagram/pictures/pictureFrame';
import type { Point } from '../../lib/geometry';
import type { PaperLineItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { erodeLine, erodeSegment } from '../../lib/paper/paperSvg';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import type { FoldEngineOp, FoldScene } from '../engine/foldEngineWire';
import { foldUnitToScenePx } from './foldCanvasGeometry';
import { creasePatternPaperScene, FOLD_PANE_DISPLAY_DEFAULT, foldedPaneScene } from './foldPaneScenes';

/**
 * Erode on Fold's pictures, over the real engine: a flat crease reaches the
 * painter cut at every crossing — the face graph splits it at each vertex —
 * and a crease mark cut where it crosses one, yet every view erodes the
 * crease, as References draws it whole (`erodeSegment` on the line): pulled
 * back where it meets the paper's edge or a fold, never at a crossing inside
 * a face. Each case reads the ink every picture draws along one crease, its
 * pieces' erosions merged, against that line eroded whole. Skipped when the
 * bridge has not been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

/** A noticeable erode: a twenty-fifth of the sheet, the Settings slider's top. */
const ERODE = 0.04;
/** A pinch's length, a sixteenth of the sheet, as the tool offers. */
const PINCH = 1 / 16;

async function engine(): Promise<FoldEngineCalls> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return createFoldEngineCalls(new wasm.FoldEngine());
}

type Pair = [number, number];

const through = (a: Pair, b: Pair) => ({ via: 'axiom', axiom: 1, inputs: [{ kind: 'point', at: a }, { kind: 'point', at: b }] });
const horizontal = (y: number) => ({ n: [0, 1] as Pair, d: y });
const vertical = (x: number) => ({ n: [1, 0] as Pair, d: x });

interface Step {
  op: FoldEngineOp;
  root: { n: Pair; d: number };
}

function precrease(a: Pair, b: Pair, moving: Pair, root: Step['root'], pinchAt?: Pair): Step {
  const extent = pinchAt ? { extent: { kind: 'pinch', at: { kind: 'point', at: pinchAt }, length: PINCH } } : {};
  return { op: { kind: 'precrease', line: through(a, b), direction: 'valley', moving, seed: { scope: 'all' }, ...extent } as FoldEngineOp, root };
}

/** The top half valley-folded down over the bottom: two layers, the fold at y = ½. */
const BOOK: Step = {
  op: { kind: 'valley', line: through([0, 0.5], [1, 0.5]), moving: [0.6, 0.9], seed: { scope: 'all' } } as FoldEngineOp,
  root: horizontal(0.5),
};

function fold(calls: FoldEngineCalls, steps: readonly Step[]): { scene: FoldScene; sheet: [number, number][]; step: number } {
  const sheet = calls.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw new Error('no sheet');
  let state = sheet.state;
  for (const { op, root } of steps) {
    const landed = calls.step(state, op, { root });
    if (landed.status !== 'ok') throw new Error(`refused: ${JSON.stringify(landed.refusal)}`);
    state = landed.state;
  }
  const summary = calls.summary(state);
  return { scene: calls.scene(state), sheet: summary.sheet.map(([x, y]) => [x, y] as Pair), step: steps.length };
}

/**
 * The ink a scene draws along the line `from`–`to` (Fold units, placed by
 * `place`) in the aux pen, under erode: each piece on the line eroded as the
 * painter erodes it, as parameters along the line, touching stretches merged.
 * `which` picks the pieces by layer: what shows, or what is buried.
 */
function inkAlong(
  scene: PaperScene,
  [from, to]: [Point, Point],
  place: (point: Point) => ScenePoint,
  which: (line: PaperLineItem) => boolean = () => true
): number[][] {
  const [a, b] = [place(from), place(to)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const span = dx * dx + dy * dy;
  const length = Math.sqrt(span);
  const offLine = ([x, y]: ScenePoint) => Math.abs(dx * (y - a[1]) - dy * (x - a[0])) / length;
  const along = ([x, y]: ScenePoint) => ((x - a[0]) * dx + (y - a[1]) * dy) / span;
  const stretches: number[][] = [];
  for (const item of scene.items) {
    if (item.kind !== 'line' || item.role !== 'aux' || !which(item)) continue;
    if (offLine(item.a) > 0.05 || offLine(item.b) > 0.05) continue;
    const ink = erodeLine(item, ERODE * scene.sheet);
    if (!ink) continue;
    stretches.push([along(ink[0]), along(ink[1])].sort((p, q) => p - q));
  }
  stretches.sort((p, q) => p[0]! - q[0]!);
  const merged: number[][] = [];
  for (const [low, high] of stretches) {
    const last = merged[merged.length - 1];
    if (last && low! <= last[1]! + 1e-6) last[1] = Math.max(last[1]!, high!);
    else merged.push([low!, high!]);
  }
  return merged.map(([low, high]) => [round(low!), round(high!)]);
}

/**
 * What References draws of the same crease, `length` long in sheet units: the
 * line whole, eroded at the ends that meet the paper's edge or a fold — as
 * parameters along a line from the crease's start that is `along` long.
 */
function wholeInk(length: number, onBoundary: [boolean, boolean], along = length): number[][] {
  const eroded = erodeSegment([0, 0], [length, 0], onBoundary, ERODE);
  return eroded ? [stretch(eroded[0][0] / along, eroded[1][0] / along)] : [];
}

/** A stretch of a line, at the precision {@link inkAlong} reads one. */
const stretch = (low: number, high: number) => [round(low), round(high)];

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** The Diagram's picture of a Fold state, flat, front up: the scene a Fold step keeps. */
function diagramScene(scene: FoldScene): PaperScene {
  const captured = flatScenePicture(foldScenePattern(scene, 'front'), 0);
  if (captured.kind !== 'picture' || captured.picture.kind !== 'scene') throw new Error('a scene picture');
  return storedScene(captured.picture)!;
}
const inDiagram = ({ x, y }: Point): ScenePoint => [
  x * PATTERN_PER_SHEET_UNIT * CAPTURE_PX_PER_UNIT,
  -y * PATTERN_PER_SHEET_UNIT * CAPTURE_PX_PER_UNIT,
];

const shows = (line: PaperLineItem) => !line.hidden;
const buried = (line: PaperLineItem) => line.hidden;

describe.skipIf(!available)('erode on Fold’s pictures', () => {
  it('pulls two crossing precreases back at the paper’s edge, never at their crossing', async () => {
    const { scene, sheet, step } = fold(await engine(), [
      precrease([0.5, 0], [0.5, 1], [0.75, 0.5], vertical(0.5)),
      precrease([0, 0.5], [1, 0.5], [0.5, 0.75], horizontal(0.5)),
    ]);
    const whole = wholeInk(1, [true, true]);
    expect(whole).toEqual([[ERODE, 1 - ERODE]]);
    const cp = creasePatternPaperScene(scene, { display: FOLD_PANE_DISPLAY_DEFAULT, sheet, step: step + 1 });
    for (const [picture, place] of [
      [foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT), foldUnitToScenePx],
      [cp, foldUnitToScenePx],
      [diagramScene(scene), inDiagram],
    ] as const) {
      expect(inkAlong(picture, [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], place)).toEqual(whole);
      expect(inkAlong(picture, [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], place)).toEqual(whole);
    }
  });

  it('keeps a pinch on a precrease whole: it ends inside the paper, and the crossing is no end', async () => {
    const { scene } = fold(await engine(), [
      precrease([0.5, 0], [0.5, 1], [0.75, 0.5], vertical(0.5)),
      precrease([0, 0.25], [1, 0.25], [0.5, 0.5], horizontal(0.25), [0.5, 0.25]),
    ]);
    // The pinch is cut in two where the precrease bounds the faces it lies on.
    expect(scene.aux_lines).toHaveLength(2);
    const pinch = [stretch(0.5 - PINCH / 2, 0.5 + PINCH / 2)];
    const line: [Point, Point] = [{ x: 0, y: 0.25 }, { x: 1, y: 0.25 }];
    expect(inkAlong(foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT), line, foldUnitToScenePx)).toEqual(pinch);
    expect(inkAlong(diagramScene(scene), line, inDiagram)).toEqual(pinch);
  });

  it('erodes a precrease that another cuts near the edge as one crease: the stub past the pull stays', async () => {
    const { scene, sheet, step } = fold(await engine(), [
      precrease([0.5, 0], [0.5, 1], [0.75, 0.5], vertical(0.5)),
      precrease([0, 1 / 16], [1, 1 / 16], [0.5, 0.5], horizontal(1 / 16)),
    ]);
    // A sixteenth from the edge, the piece below the crossing is shorter than twice the pull.
    expect(1 / 16).toBeLessThan(2 * ERODE);
    const whole = wholeInk(1, [true, true]);
    const line: [Point, Point] = [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }];
    const cp = creasePatternPaperScene(scene, { display: FOLD_PANE_DISPLAY_DEFAULT, sheet, step: step + 1 });
    expect(inkAlong(foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT), line, foldUnitToScenePx)).toEqual(whole);
    expect(inkAlong(cp, line, foldUnitToScenePx)).toEqual(whole);
    expect(inkAlong(diagramScene(scene), line, inDiagram)).toEqual(whole);
  });

  it('erodes each layer’s precrease at the fold and the edge, and keeps a pinch across it whole on both', async () => {
    const { scene } = fold(await engine(), [
      BOOK,
      precrease([0.5, 0], [0.5, 0.5], [0.75, 0.25], vertical(0.5)),
      precrease([0, 0.25], [1, 0.25], [0.5, 0.1], horizontal(0.25), [0.5, 0.25]),
    ]);
    // Half a sheet from the raw edge to the fold, pulled back at both.
    const crease = wholeInk(0.5, [true, true], 1);
    const pinch = [stretch(0.5 - PINCH / 2, 0.5 + PINCH / 2)];
    const upright: [Point, Point] = [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }];
    const across: [Point, Point] = [{ x: 0, y: 0.25 }, { x: 1, y: 0.25 }];
    const pane = foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT);
    const diagram = diagramScene(scene);
    for (const layer of [shows, buried]) {
      expect(inkAlong(pane, upright, foldUnitToScenePx, layer)).toEqual(crease);
      expect(inkAlong(pane, across, foldUnitToScenePx, layer)).toEqual(pinch);
    }
    expect(inkAlong(diagram, upright, inDiagram, shows)).toEqual(crease);
    expect(inkAlong(diagram, across, inDiagram, shows)).toEqual(pinch);
  });

  it('pulls every precrease back where a fold meets it, whichever face draws it', async () => {
    // Precreased flat, then folded: the vertical and both diagonals of the top
    // half meet the fold at its middle, where each face round that vertex has
    // only flat creases beside it.
    const { scene } = fold(await engine(), [
      precrease([0.5, 0], [0.5, 1], [0.75, 0.5], vertical(0.5)),
      precrease([0, 0], [1, 1], [1 / 3, 2 / 3], { n: [Math.SQRT1_2, -Math.SQRT1_2], d: 0 }),
      precrease([0, 1], [1, 0], [1 / 6, 0.5], { n: [Math.SQRT1_2, Math.SQRT1_2], d: Math.SQRT1_2 }),
      BOOK,
    ]);
    const crease = wholeInk(0.5, [true, true], 1);
    const pane = foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT);
    expect(inkAlong(pane, [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], foldUnitToScenePx, shows)).toEqual(crease);
    expect(inkAlong(diagramScene(scene), [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], inDiagram, shows)).toEqual(crease);
    // The top half's diagonals, folded down: from the fold's middle to the corners below.
    const diagonal = wholeInk(Math.SQRT1_2, [true, true]);
    for (const corner of [{ x: 0, y: 0 }, { x: 1, y: 0 }]) {
      expect(inkAlong(pane, [{ x: 0.5, y: 0.5 }, corner], foldUnitToScenePx, shows)).toEqual(diagonal);
    }
  });
});

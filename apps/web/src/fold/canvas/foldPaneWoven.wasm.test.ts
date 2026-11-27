import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import type { FoldTuckOp, SheetPoint } from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import type { FoldEngineOp, FoldScene } from '../engine/foldEngineWire';
import { foldUnitToScenePx } from './foldCanvasGeometry';
import { FOLD_PANE_DISPLAY_DEFAULT, foldedPaneScene } from './foldPaneScenes';

/**
 * A woven order on the folded pane, over the real engine, Spread layers off:
 * a buried edge stays buried. A strip is folded into a square ring by four
 * 45° valleys and its end tucked under its start, reaching into the first
 * corner, so each side lies over the one before and the start over the end.
 * No order of whole faces draws that, so the painter draws the start last
 * and patches the second side back over it — including over the start's
 * edge where it runs under the second side, which the second side's cell
 * finds through the cell across it. The engine's cells meet there at a
 * corner partway along an edge, and at corners a few bits apart; unsealed,
 * the painter found no cell across, took the edge for the figure's rim and
 * left half the stroke on top: a thin pale line across the second side.
 * Skipped when the bridge has not been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

async function engine(): Promise<{ calls: FoldEngineCalls; compound: FoldEngineCompoundCalls }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return { calls: createFoldEngineCalls(fold), compound: createFoldEngineCompoundCalls(fold) };
}

/** The strip's width, where the first crease crosses its middle, and each side's length. */
const WIDTH = 0.08;
const FIRST = 0.15;
const SIDE = 0.2125;

/** The k-th 45° crease across the strip, in sheet coordinates: the diagonals alternate, each turning the same way once folded. */
function crease(k: number): { through: [SheetPoint, SheetPoint]; beyond: SheetPoint } {
  const c = FIRST + SIDE * k;
  const half = WIDTH / 2;
  const through: [SheetPoint, SheetPoint] = k % 2 === 0
    ? [[c - half, 0], [c + half, WIDTH]]
    : [[c + half, 0], [c - half, WIDTH]];
  return { through, beyond: [c + 0.01, half] };
}

function landed<T extends { status: string }>(outcome: T): Extract<T, { status: 'ok' }> {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome)}`);
  return outcome as Extract<T, { status: 'ok' }>;
}

/** Whether "over" in the scene's stacks has a cycle: no face can be drawn first. */
function cyclic(scene: FoldScene): boolean {
  const below = scene.faces.map(() => new Set<number>());
  for (const { faces_top_to_bottom: stack } of scene.subfaces) {
    for (let i = 0; i + 1 < stack.length; i += 1) below[stack[i]!]!.add(stack[i + 1]!);
  }
  const drawn = new Set<number>();
  for (;;) {
    const next = below.findIndex((under, face) => !drawn.has(face) && [...under].every((g) => drawn.has(g)));
    if (next < 0) return drawn.size < scene.faces.length;
    drawn.add(next);
  }
}

/** The tucked ring, in the order that closes its cycle. */
function tuckedRing({ calls, compound }: Awaited<ReturnType<typeof engine>>): FoldScene {
  let state = landed(calls.sheet({ shape: { kind: 'rectangle', aspect: [1, WIDTH] }, startSide: 'front' })).state;
  for (let k = 0; k < 3; k += 1) {
    const { through, beyond } = crease(k);
    const op = {
      kind: 'valley', line: { via: 'free', through }, moving: beyond, seed: { scope: 'flaps', at: [beyond] },
      landing: { kind: 'outer' },
    } as FoldEngineOp;
    state = landed(calls.step(state, op)).state;
  }
  const { through, beyond } = crease(3);
  const tuck: FoldTuckOp = {
    kind: 'tuck', line: { via: 'free', through }, moving: beyond, seed: { scope: 'flaps', at: [beyond] },
    direction: 'valley', target: [0.02, WIDTH / 2],
  };
  // The end's corner with the fourth side goes either way; one way closes the ring.
  for (let index = 0; index < 2; index += 1) {
    const { completion } = landed(compound.orderSelection(state, tuck, undefined, { index }));
    const scene = calls.scene(landed(calls.step(state, tuck, completion ? { completion } : undefined)).state);
    if (cyclic(scene)) return scene;
  }
  throw new Error('no order closes the ring');
}

/**
 * Ink a painted stroke leaves where no line should show: just beside the
 * stroke, on a side nothing painted later covers, the top face is the same
 * on both sides of it and is not the stroke's own. A line shows only where
 * the top face changes. Every stroke is sampled: lines, and the outlines
 * faces draw themselves.
 */
function strayInk(scene: FoldScene, painted: PaperScene): string[] {
  const unit = foldUnitToScenePx({ x: 1, y: 0 })[0];
  const model = ([x, y]: ScenePoint): Point => ({ x: x / unit, y: -y / unit });
  const inside = (polygon: readonly Point[], p: Point) => {
    let odd = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!, b = polygon[j]!;
      if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) odd = !odd;
    }
    return odd;
  };
  const topAt = (p: Point) => scene.subfaces.find((sub) => inside(sub.polygon, p))?.faces_top_to_bottom[0] ?? -1;
  const fills = painted.items.map((item) => (item.kind === 'face' && !item.hidden ? item.rings[0]!.map(model) : null));
  const covered = (after: number, p: Point) => fills.some((fill, k) => k > after && fill !== null && inside(fill, p));
  const strokes: { at: number; face: number; a: Point; b: Point }[] = [];
  painted.items.forEach((item, at) => {
    if (item.hidden) return;
    if (item.kind === 'line') strokes.push({ at, face: item.face ?? -1, a: model(item.a), b: model(item.b) });
    if (item.kind === 'face' && item.outline) {
      const ring = item.rings[0]!.map(model);
      ring.forEach((a, k) => strokes.push({ at, face: item.face, a, b: ring[(k + 1) % ring.length]! }));
    }
  });
  const BESIDE = 1e-3;
  const at3 = ({ x, y }: Point) => `(${x.toFixed(3)}, ${y.toFixed(3)})`;
  const stray: string[] = [];
  for (const { at, face, a, b } of strokes) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) continue;
    const n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    const over = new Set<number>();
    for (let s = 1; s < 50; s += 1) {
      const p = { x: a.x + ((b.x - a.x) * s) / 50, y: a.y + ((b.y - a.y) * s) / 50 };
      for (const side of [1, -1]) {
        const here = { x: p.x + side * BESIDE * n.x, y: p.y + side * BESIDE * n.y };
        const there = { x: p.x - side * BESIDE * n.x, y: p.y - side * BESIDE * n.y };
        const top = topAt(here);
        if (top >= 0 && top !== face && !covered(at, here) && topAt(there) === top) over.add(top);
      }
    }
    for (const top of over) stray.push(`face ${face}'s edge ${at3(a)}–${at3(b)} shows over face ${top}`);
  }
  return stray;
}

describe.skipIf(!available)('a woven order on the folded pane', () => {
  it('leaves no buried edge of the tucked ring on top', async () => {
    const scene = tuckedRing(await engine());
    const painted = foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT);
    // Woven: some face is patched back over one drawn after it.
    expect(painted.items.some((item) => item.kind === 'face' && item.group !== undefined)).toBe(true);
    expect(strayInk(scene, painted)).toEqual([]);
  });
});

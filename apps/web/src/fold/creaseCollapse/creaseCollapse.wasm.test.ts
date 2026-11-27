import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { applyIsometry, insideConvex, invertIsometry } from '../canvas/foldCanvasGeometry';
import type { FoldCollapseCrease, FoldCollapseTo, FoldOp, FoldStep } from '../document/foldSequenceDocument';
import { isLockedStep } from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineIoCalls, type FoldEngineIoCalls } from '../engine/foldEngineIoCalls';
import type { FoldScene } from '../engine/foldEngineWire';
import { collapseChoice } from './useFoldCreaseCollapseTool';

/**
 * Collapse against a real Import CP (`implementation-plans/fold-collapse-existing-creases.md`):
 * the owner's model in `tests/fixtures/fold-regressions/collapse-person-step-28.osf`,
 * whose step 28 is an Import CP that collapses the paper along creases it
 * already has, and one short line it drew. A Precrease makes that line, and
 * a Collapse sets the rest; the Collapse lands the same paper the Import CP
 * did: the same folded lines, and at every cell the same sheet points
 * stacked in the same order with the same side up, once the views agree (a
 * Collapse keeps the root face the parent had still, so it lands a quarter
 * turn from the import, and a Rotate puts it back).
 *
 * Skipped when the bridge has not been built.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const FIXTURE = resolve(ROOT, '../../tests/fixtures/fold-regressions/collapse-person-step-28.osf');
const available = existsSync(WASM) && existsSync(FIXTURE);

type Calls = FoldEngineCalls & FoldEngineIoCalls;

async function engine(): Promise<{ calls: Calls; keys: (state: number) => string[] }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return { calls: { ...createFoldEngineCalls(fold), ...createFoldEngineIoCalls(fold) }, keys: (state) => fold.canonical_keys(state) };
}

function landed(calls: Calls, state: number, op: FoldOp, choices?: FoldStep['choices']): number {
  const result = calls.apply(state, op, choices);
  if (result.status !== 'ok') throw new Error(`${op.kind} refused: ${JSON.stringify(result.refusal)}`);
  return result.state;
}

/** The line the Import CP drew that the paper lacked: a Precrease on the top layer at its point. */
const PRECREASE: FoldOp = {
  kind: 'precrease',
  line: { via: 'free', through: [[0.12499999999999993, 0.8751558603491272], [0.125, 0.9998441396508728]] },
  moving: [0.115, 0.9375],
  seed: { scope: 'depth', at: [0.115, 0.9375], layers: 1 },
  direction: 'valley',
};

/** What the Collapse sets: each stretch of the creases and what it becomes. */
const SET: readonly [[number, number], [number, number], FoldCollapseTo][] = [
  [[0, 0.5], [0.25, 0.5], 'valley'],
  [[0, 0.75], [0.125, 0.875], 'mountain'],
  [[0, 0.75], [0.25, 0.75], 'open'],
  [[0, 0.25], [0.0625, 0.3125], 'valley'],
  [[0.0625, 0.3125], [0.25, 0.5], 'mountain'],
  [[0.125, 0.875], [0.125, 1], 'valley'],
  [[0.125, 0.875], [0.25, 0.75], 'valley'],
  [[0.125, 0.875], [0.375, 0.875], 'open'],
  [[0.25, 0.5], [0.25, 0.75], 'open'],
  [[0.25, 0.5], [0.375, 0.625], 'valley'],
  [[0.25, 0.75], [0.375, 0.625], 'mountain'],
  [[0.375, 0.625], [0.375, 0.875], 'open'],
  [[0.375, 0.625], [0.625, 0.625], 'mountain'],
  [[0.625, 0.625], [0.625, 0.875], 'open'],
  [[0.625, 0.625], [0.75, 0.5], 'valley'],
  [[0.625, 0.625], [0.75, 0.75], 'mountain'],
  [[0.625, 0.875], [0.875, 0.875], 'open'],
  [[0.75, 0.5], [0.75, 0.75], 'open'],
  [[0.75, 0.5], [0.9375, 0.3125], 'mountain'],
  [[0.75, 0.5], [1, 0.5], 'valley'],
  [[0.75, 0.75], [0.875, 0.875], 'valley'],
  [[0.75, 0.75], [1, 0.75], 'open'],
  [[0.875, 0.875], [0.875, 1], 'valley'],
  [[0.875, 0.875], [1, 0.75], 'mountain'],
  [[0.9375, 0.3125], [1, 0.25], 'valley'],
];

/** The folded lines of a state, collinear pieces merged, letter by letter: what the paper's folds are. */
function foldedLines(keys: readonly string[]): string[] {
  const lines = new Map<string, [number, number][]>();
  for (const key of keys) {
    const m = /^c:(-?\d+),(-?\d+);(-?\d+),(-?\d+):([MV])$/.exec(key);
    if (!m) continue;
    const [ax, ay, bx, by] = m.slice(1, 5).map((v) => Number(v) / 1e9) as [number, number, number, number];
    const length = Math.hypot(bx - ax, by - ay);
    let [dx, dy] = [(bx - ax) / length, (by - ay) / length];
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) [dx, dy] = [-dx, -dy];
    const off = ax * dy - ay * dx;
    const line = `${m[5]}|${dx.toFixed(6)},${dy.toFixed(6)}|${off.toFixed(6)}`.replaceAll('-0.000000', '0.000000');
    const [t0, t1] = [ax * dx + ay * dy, bx * dx + by * dy];
    lines.set(line, [...(lines.get(line) ?? []), [Math.min(t0, t1), Math.max(t0, t1)]]);
  }
  const out: string[] = [];
  for (const [line, spans] of lines) {
    spans.sort((p, q) => p[0] - q[0]);
    let [s, e] = spans[0]!;
    for (const [a, b] of spans.slice(1)) {
      if (a <= e + 1e-6) e = Math.max(e, b);
      else {
        out.push(`${line}|${s.toFixed(6)}..${e.toFixed(6)}`);
        [s, e] = [a, b];
      }
    }
    out.push(`${line}|${s.toFixed(6)}..${e.toFixed(6)}`);
  }
  return out.map((k) => k.replaceAll('-0.000000', '0.000000')).sort();
}

/** The paper at a scene point: each layer's sheet point and side, top first; null off the paper. */
function stackAt(scene: FoldScene, p: { x: number; y: number }): string | null {
  const cell = scene.subfaces.find((each) => insideConvex(each.polygon, p, -1e-7));
  if (!cell) return null;
  return cell.faces_top_to_bottom
    .map((face) => {
      const transform = scene.face_transforms[face]!;
      const sheet = applyIsometry(invertIsometry(transform), p);
      const front = transform[0] * transform[4] - transform[1] * transform[3] > 0;
      return `${sheet.x.toFixed(5)},${sheet.y.toFixed(5)}:${front ? 'F' : 'B'}`;
    })
    .join(' ');
}

describe.skipIf(!available)('Collapse against a real Import CP', () => {
  it('lands the paper the Import CP landed, every folded line and every layer', async () => {
    const project = parseNativeProjectFile(readFileSync(FIXTURE, 'utf8'));
    const [held] = readFoldSequences(project.workspace.foldSequences);
    if (!held) throw new Error('no sequence');
    const steps = held.document.steps.filter((node): node is FoldStep => !isLockedStep(node));
    const { calls, keys } = await engine();
    const sheet = calls.sheet(held.document.paper);
    if (sheet.status !== 'ok') throw new Error('no sheet');
    let parent = sheet.state;
    for (const step of steps.slice(0, -1)) parent = landed(calls, parent, step.op, step.choices);
    const imported = steps.at(-1)!;
    expect(imported.op.kind).toBe('cp-jump');
    const saved = landed(calls, parent, imported.op);

    const precreased = landed(calls, parent, PRECREASE);
    const creases: FoldCollapseCrease[] = SET.map(([a, b, to]) => ({ a, b, to }));
    const opened = calls.collapseOpen(precreased, creases);
    if (opened.status !== 'ok') throw new Error(`refused: ${JSON.stringify(opened.refusal)}`);
    expect(opened.count).toEqual({ orders: 4, exact: true });
    const step = calls.collapseOp(opened.import, collapseChoice(opened.components, 3));
    if (step.status !== 'ok') throw new Error(`refused: ${JSON.stringify(step.refusal)}`);
    expect(step.op.kind).toBe('collapse');
    const collapsed = landed(calls, precreased, step.op);
    const turned = landed(calls, collapsed, { kind: 'rotate', rotate: { amount: 'quarter', direction: 'ccw' } });

    // The same folds.
    expect(foldedLines(keys(turned))).toEqual(foldedLines(keys(saved)));
    // The same layers at every cell of the saved paper, and the Collapse's paper nowhere the saved has none.
    const a = calls.scene(turned);
    const b = calls.scene(saved);
    const centre = (polygon: readonly { x: number; y: number }[]) => ({
      x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
      y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length,
    });
    // Where the model sits on the table is the view's, not the paper's: line the two up by their corners.
    const corner = (scene: FoldScene) => {
      const points = scene.subfaces.flatMap((cell) => cell.polygon);
      return { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) };
    };
    const [ca, cb] = [corner(a), corner(b)];
    const toA = (p: { x: number; y: number }) => ({ x: p.x - cb.x + ca.x, y: p.y - cb.y + ca.y });
    const toB = (p: { x: number; y: number }) => ({ x: p.x - ca.x + cb.x, y: p.y - ca.y + cb.y });
    for (const cell of b.subfaces) {
      const p = centre(cell.polygon);
      expect(stackAt(a, toA(p)), `at ${p.x}, ${p.y}`).toBe(stackAt(b, p));
    }
    for (const cell of a.subfaces) {
      const p = centre(cell.polygon);
      expect(stackAt(b, toB(p)), `at ${p.x}, ${p.y}`).toBe(stackAt(a, p));
    }
    calls.releaseImports([opened.import]);
  });
});

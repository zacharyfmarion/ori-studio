/**
 * The timing probe the Pleat and Repeat budgets were chosen from
 * (`PLEAT_SEARCH_MS`, `REPEAT_PREPARATION_MS`): not a check, so it runs only
 * with FOLD_SEARCH_TIMING=1, and writes its rows to FOLD_SEARCH_TIMING_OUT
 * (a directory) or stderr. Every search runs with no budget, so what it times
 * is what the counts alone allow.
 *
 * - Pleat: every state of every design fixture with eight faces or more, a
 *   pleat of every layer across the folded model at seven places on each axis.
 * - Repeat: every range of every fixture from a state with a verified axis,
 *   on every axis; then long synthetic ranges, the longest the caps allow.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';
import { applyIsometry } from '../canvas/foldCanvasGeometry';
import { readFoldSequences } from '../document/foldSequenceFile';
import type { FoldOp, FoldPleatOp, SheetPoint } from '../document/foldSequenceDocument';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { modelMap, repeatSymmetries, sheetRing } from '../repeat/repeatGeometry';
import { prepareRepeatSearch, type RepeatRequest, type RepeatSourceStep } from '../repeat/repeatPreparation';
import { pleatOrderSearch } from '../tools/pleat/pleatEngine';
import { createFoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import { runFoldSearch } from './foldSearch';

const ON = process.env.FOLD_SEARCH_TIMING === '1';

/** The engine, with every bridge call counted and timed. */
async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm')) });
  const raw = new wasm.FoldEngine();
  const counts = new Map<string, { n: number; ms: number }>();
  const counted = new Proxy(raw, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const t = performance.now();
        try {
          return (value as (...given: unknown[]) => unknown).apply(target, args);
        } finally {
          const c = counts.get(String(key)) ?? { n: 0, ms: 0 };
          c.n += 1;
          c.ms += performance.now() - t;
          counts.set(String(key), c);
        }
      };
    },
  });
  const calls = { ...createFoldEngineCalls(counted), ...createFoldEngineCompoundCalls(counted) };
  const tally = () => [...counts].map(([key, c]) => `${key}×${c.n}=${fmt(c.ms)}`).join(' ');
  return { calls, raw: counted, counts, tally };
}
type Engine = Awaited<ReturnType<typeof engine>>;

function replay(e: Engine['calls'], name: string) {
  const file = parseNativeProjectFile(readFileSync(resolve(process.cwd(), '../../tests/fixtures/fold-design-completion', `${name}.osf`), 'utf8'));
  const document = readFoldSequences(file.workspace.foldSequences)[0]!.document;
  const sheet = e.sheet(document.paper);
  if (sheet.status !== 'ok') throw new Error('sheet');
  const states = [sheet.state];
  const steps: RepeatSourceStep[] = [];
  for (const node of document.steps) {
    if (!node.op) throw new Error('locked');
    const before = states.at(-1)!;
    const landed = e.step(before, node.op, node.choices);
    if (landed.status !== 'ok') throw new Error(`${name} ${node.id}: ${JSON.stringify(landed.refusal)}`);
    states.push(landed.state);
    steps.push({ id: node.id, before, after: landed.state, op: node.op, ...(node.choices ? { choices: node.choices } : {}) });
  }
  return { states, steps, sheet };
}

const fmt = (ms: number) => `${ms.toFixed(0)} ms`;
const FIXTURES = ['crane', 'heart', 'cicada', 'swan', 'box'];

function report(name: string, lines: string[]) {
  const out = process.env.FOLD_SEARCH_TIMING_OUT;
  if (out) writeFileSync(resolve(out, `${name}.txt`), `${lines.join('\n')}\n`);
  else process.stderr.write(`${lines.join('\n')}\n`);
}

/**
 * A pleat of every layer across the folded model: mountain at `a`, valley at
 * `b` of the model's extent along an axis, the far end moving. Its lines run
 * through the sheet points seen at either end; null where the paper offers none.
 */
function pleatAcross(e: Engine['calls'], state: number, axis: 0 | 1, a: number, b: number): FoldPleatOp | null {
  const scene = e.scene(state);
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (let f = 0; f < scene.faces.length; f++)
    for (const p of sheetRing(scene, f).map((q) => applyIsometry(modelMap(scene, f), q))) {
      lo = [Math.min(lo[0]!, p.x), Math.min(lo[1]!, p.y)];
      hi = [Math.max(hi[0]!, p.x), Math.max(hi[1]!, p.y)];
    }
  const at = (u: number, w: number): readonly [number, number] =>
    axis === 0 ? [lo[0]! + u * (hi[0]! - lo[0]!), lo[1]! + w * (hi[1]! - lo[1]!)] : [lo[0]! + w * (hi[0]! - lo[0]!), lo[1]! + u * (hi[1]! - lo[1]!)];
  const sheetAt = (u: number, w: number) => e.topVisibleAt(state, at(u, w))?.sheet ?? null;
  const ends = (u: number): readonly [SheetPoint, SheetPoint] | null => {
    let low: SheetPoint | null = null, high: SheetPoint | null = null;
    for (let k = 1; k < 40 && !low; k++) low = sheetAt(u, k / 40);
    for (let k = 39; k > 0 && !high; k--) high = sheetAt(u, k / 40);
    return low && high && Math.hypot(low[0] - high[0], low[1] - high[1]) > 1e-3 ? [low, high] : null;
  };
  let moving: SheetPoint | null = null;
  for (let k = 1; k < 40 && !moving; k++) moving = sheetAt(Math.min(0.99, b + 0.05), k / 40);
  const m = ends(a), v = ends(b);
  return m && v && moving ? { kind: 'pleat', line: { via: 'free', through: m }, second: { via: 'free', through: v }, moving, seed: { scope: 'all' } } : null;
}

/** A repeat's preparation with no budget, timed. */
function timedRepeat(e: Engine, request: RepeatRequest) {
  e.counts.clear();
  const t = performance.now();
  const prepared = runFoldSearch(prepareRepeatSearch(e.calls, request), Infinity);
  const ms = performance.now() - t;
  const what = prepared.status === 'blocked' ? `blocked ${prepared.code} at ${prepared.step}` : prepared.status;
  return { prepared, ms, line: `${fmt(ms)} → ${what} | ${e.tally()}` };
}

describe.skipIf(!ON)('Fold search timing', () => {
  it('Pleat order search on every state of every fixture', { timeout: 3_600_000 }, async () => {
    const rows: string[] = [];
    let worst = { ms: 0, label: '' };
    for (const name of FIXTURES) {
      const e = await engine();
      const { states } = replay(e.calls, name);
      for (const [index, state] of states.entries()) {
        const faces = e.calls.summary(state).faces;
        if (faces < 8) continue;
        for (const axis of [0, 1] as const)
          for (let a = 0.13; a < 0.8; a += 0.11) {
            const op = pleatAcross(e.calls, state, axis, a, a + 0.13);
            if (!op) continue;
            e.counts.clear();
            const t = performance.now();
            const result = runFoldSearch(pleatOrderSearch(e.raw, state, op, undefined, { index: 0 }), Infinity);
            const ms = performance.now() - t;
            const what = result.status === 'ok' ? `ok ${result.count.orders}` : JSON.stringify(result.refusal).slice(0, 60);
            const label = `${name} step ${index} (${faces} faces) axis ${axis} ${a.toFixed(2)}`;
            rows.push(`${label}: ${fmt(ms)} → ${what} | ${e.tally()}`);
            if (ms > worst.ms) worst = { ms, label };
          }
      }
      report('pleat', ['PLEAT', ...rows, `WORST ${fmt(worst.ms)} ${worst.label}`, `PLEATS ${rows.length}`]);
    }
  });

  it('Repeat preparation over every symmetric range of every fixture', { timeout: 3_600_000 }, async () => {
    const rows: string[] = [];
    let worst = { ms: 0, label: '' };
    for (const name of FIXTURES) {
      const e = await engine();
      const { states, steps, sheet } = replay(e.calls, name);
      for (let first = 0; first < steps.length; first++) {
        const axes = repeatSymmetries(e.calls.scene(steps[first]!.before), sheet.summary.sheet);
        for (let last = first; last < steps.length; last++)
          for (const [k, axis] of axes.entries()) {
            const { ms, line } = timedRepeat(e, {
              parent: states[last + 1]!,
              source: { first: steps[first]!.id, last: steps[last]!.id, revision: 'timing' },
              steps: steps.slice(first, last + 1),
              axis: axis.sheet,
              baseline: first === 0 ? null : steps[first - 1]!.id,
            });
            const label = `${name} ${first}..${last} axis ${k} (${e.calls.summary(states[last + 1]!).faces} faces)`;
            rows.push(`${label}: ${line}`);
            if (ms > worst.ms) worst = { ms, label };
          }
      }
    }
    report('repeat', ['REPEAT', ...rows, `WORST ${fmt(worst.ms)} ${worst.label}`, `RANGES ${rows.length}`]);
  });

  // No fixture has a repeatable range of more than two operations, and the
  // caps allow 128. A grid of horizontal precreases is the baseline (folded
  // in half first, or not); V vertical precreases on the left half are the
  // range, mirrored across x = 1/2. Faces grow as H × V on each side.
  it('Repeat preparation and execution over a long synthetic range', { timeout: 3_600_000 }, async () => {
    const rows: string[] = [];
    for (const folded of [false, true])
      for (const [h, v] of [[4, 8], [8, 8], [8, 16], [16, 16], [16, 32], [8, 64], [4, 127]] as const) {
        const e = await engine();
        const { steps, current } = build(e.calls, (land) => {
          if (folded) land({ kind: 'valley', line: { via: 'free', through: [[0, 0.5], [1, 0.5]] }, moving: [0.5, 0.9], seed: { scope: 'all' } });
          const span = folded ? 0.5 : 1;
          for (let k = 1; k < h; k++) {
            const y = (span * k) / h;
            land({ kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[0, y], [1, y]] }, moving: [0.5, y / 2], seed: { scope: 'all' } });
          }
        }, Array.from({ length: v }, (_, k) => {
          const x = (0.5 * (k + 1)) / (v + 1);
          return { kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[x, 0], [x, folded ? 0.5 : 1]] }, moving: [x / 2, 0.25], seed: { scope: 'all' } };
        }));
        const { prepared, line } = timedRepeat(e, { parent: current, source: { first: steps[0]!.id, last: steps.at(-1)!.id, revision: 'timing' }, steps, axis: { n: [1, 0], d: 0.5 }, baseline: null });
        let executed = '';
        if (prepared.status === 'ready') {
          const t = performance.now();
          const result = e.calls.step(current, prepared.op);
          executed = ` | execute ${fmt(performance.now() - t)} → ${result.status}`;
        }
        rows.push(`${folded ? 'folded' : 'flat'} H${h} V${v} (${e.calls.summary(current).faces} faces): prepare ${line}${executed}`);
        report('repeat-synthetic', ['REPEAT SYNTHETIC', ...rows]);
      }
  });

  // What the segment cap does not bound: view changes on a dense symmetric
  // model. Every face moves at every step, so every step compares every face
  // of four scenes with every other.
  it('Repeat preparation of turn-overs on a dense grid', { timeout: 3_600_000 }, async () => {
    const rows: string[] = [];
    for (const [n, turns] of [[8, 4], [12, 4], [15, 4], [15, 16], [15, 64], [15, 128]] as const) {
      const e = await engine();
      const { steps, current } = build(e.calls, (land) => {
        for (let k = 1; k <= n; k++) {
          const c = k / (n + 1);
          land({ kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[0, c], [1, c]] }, moving: [0.5, c / 2], seed: { scope: 'all' } });
          land({ kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[c, 0], [c, 1]] }, moving: [c / 2, 0.5], seed: { scope: 'all' } });
        }
      }, Array.from({ length: turns }, () => ({ kind: 'turn', axis: 'vertical' })));
      const { line } = timedRepeat(e, { parent: current, source: { first: steps[0]!.id, last: steps.at(-1)!.id, revision: 'timing' }, steps, axis: { n: [1, 0], d: 0.5 }, baseline: null });
      rows.push(`grid ${n}×${n} turns ${turns} (${e.calls.summary(current).faces} faces): prepare ${line}`);
      report('repeat-turns', ['REPEAT TURNS', ...rows]);
    }
  });
});

/** A sheet, a baseline folded by `base`, then `range`, each step of it a source step. */
function build(e: Engine['calls'], base: (land: (op: FoldOp) => number) => void, range: readonly FoldOp[]) {
  const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw new Error('sheet');
  let current = sheet.state;
  const land = (op: FoldOp) => {
    const landed = e.step(current, op);
    if (landed.status !== 'ok') throw new Error(JSON.stringify(landed.refusal));
    const before = current;
    current = landed.state;
    return before;
  };
  base(land);
  const steps: RepeatSourceStep[] = range.map((op, k) => {
    const before = land(op);
    return { id: `r${k}`, before, after: current, op };
  });
  return { steps, current };
}

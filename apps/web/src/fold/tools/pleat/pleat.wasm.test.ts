import { applyIsometry } from '../../canvas/foldCanvasGeometry';
import { prepareRepeat } from '../../repeat/repeatPreparation';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFoldEngineCalls } from '../../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../../engine/foldEngineCompoundCalls';
import type { FoldPleatOp } from '../../document/foldSequenceDocument';
async function engine() {
  const wasm =
    await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({
    module: readFileSync(
      resolve(
        process.cwd(),
        'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm',
      ),
    ),
  });
  const raw = new wasm.FoldEngine();
  return {
    ...createFoldEngineCalls(raw),
    ...createFoldEngineCompoundCalls(raw),
  };
}
const op: FoldPleatOp = {
  kind: 'pleat',
  line: {
    via: 'free',
    through: [
      [0.5, 0],
      [0.5, 1],
    ],
  },
  second: {
    via: 'free',
    through: [
      [0.75, 0],
      [0.75, 1],
    ],
  },
  moving: [0.9, 0.5],
  seed: { scope: 'all' },
};
describe('Pleat through the public native folding operations', () => {
  it('creates only the original mountain and valley, saves both choices, and replays exactly', async () => {
    const e = await engine();
    const s = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (s.status !== 'ok') throw Error('sheet');
    const count = e.live();
    const orders = e.orderSelection(s.state, op, undefined, { index: 0 });
    expect(orders, JSON.stringify(orders)).toMatchObject({
      status: 'ok',
      count: { orders: 1, exact: true },
    });
    expect(e.live()).toBe(count);
    if (orders.status !== 'ok') return;
    const chosen = { ...op, resolved: orders.pleat };
    const folded = e.step(s.state, chosen);
    if (folded.status !== 'ok') throw Error(JSON.stringify(folded));
    const picture = e.stepAction(folded.state);
    expect(picture).toEqual(e.action(s.state, chosen));
    expect(picture).toMatchObject({ status: 'ok', action: {
      direction: 'mountain', grip: null,
      spans: expect.arrayContaining([expect.objectContaining({ direction: 'valley' })]),
      pleat: { kinks: 1 },
    } });
    const creases = e.scene(folded.state).creases.filter((c) => c.letter);
    expect(creases).toHaveLength(2);
    expect(creases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: expect.objectContaining({ x: 0.5 }),
          to: expect.objectContaining({ x: 0.5 }),
          letter: 'mountain',
        }),
        expect.objectContaining({
          from: expect.objectContaining({ x: 0.75 }),
          to: expect.objectContaining({ x: 0.75 }),
          letter: 'valley',
        }),
      ]),
    );
    const replay = e.step(s.state, JSON.parse(JSON.stringify(chosen)));
    if (replay.status !== 'ok') throw Error(JSON.stringify(replay));
    expect(replay.fingerprint).toBe(folded.fingerprint);
    e.release([folded.state, replay.state]);
    expect(e.live()).toBe(count);
  });
  it('refuses reversed or coincident lines and releases all search states', async () => {
    const e = await engine();
    const s = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (s.status !== 'ok') throw Error('sheet');
    const count = e.live();
    for (const x of [0.4, 0.5]) {
      expect(
        e.orderSelection(
          s.state,
          {
            ...op,
            second: {
              via: 'free',
              through: [
                [x, 0],
                [x, 1],
              ],
            },
          },
          undefined,
          { index: 0 },
        ),
      ).toMatchObject({
        status: 'refused',
        refusal: { code: 'pleat_failed', reason: 'lines' },
      });
      expect(e.live()).toBe(count);
    }
  });
});

it.each(['front', 'back'] as const)(
  'pleats across flat precreases on the %s and unfolds both internal folds',
  async (startSide) => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide });
    if (sheet.status !== 'ok') throw Error('sheet');
    const marked = e.step(sheet.state, {
      kind: 'precrease',
      direction: 'valley',
      line: {
        via: 'free',
        through: [
          [0, 0.4],
          [1, 0.4],
        ],
      },
      moving: [0.5, 0.9],
      seed: { scope: 'all' },
    });
    if (marked.status !== 'ok') throw Error(JSON.stringify(marked));
    const result = e.step(marked.state, op);
    if (result.status !== 'ok') throw Error(JSON.stringify(result));
    expect(result.summary.creases.mountain).toBeGreaterThan(0);
    expect(result.summary.creases.valley).toBeGreaterThan(0);
    const returned = e.returnTo(result.state, sheet.state, [
      sheet.state,
      marked.state,
      result.state,
    ]);
    if (returned.status !== 'ok') throw Error(JSON.stringify(returned));
    expect(returned.summary.creases.flat).toBeGreaterThan(2);
    const target = e.scene(sheet.state).face_transforms[0]!;
    const flat = e.scene(returned.state);
    for (let f = 0; f < flat.faces.length; f++)
      for (const vertex of flat.faces[f]!.points) {
        const a = applyIsometry(target, flat.sheet_points[vertex]!);
        const b = applyIsometry(
          flat.face_transforms[f]!,
          flat.sheet_points[vertex]!,
        );
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-8);
      }
    e.release([result.state, returned.state]);
    expect(e.live()).toBe(2);
  },
);
it('supports an angled pleat through the same two native folds', async () => {
  const e = await engine();
  const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw Error('sheet');
  const result = e.step(sheet.state, {
    ...op,
    second: {
      via: 'free',
      through: [
        [0.7, 0],
        [0.8, 1],
      ],
    },
  });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'ok' });
  if (result.status !== 'ok') return;
  expect(e.scene(result.state).creases.filter((c) => c.letter)).toHaveLength(2);
  e.release([result.state]);
  expect(e.live()).toBe(1);
});
it('returns a refusal for missing second-line material without leaking states', async () => {
  const e = await engine();
  const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw Error('sheet');
  expect(
    e.step(sheet.state, {
      ...op,
      second: {
        via: 'free',
        through: [
          [2, 0],
          [2, 1],
        ],
      },
    }),
  ).toMatchObject({
    status: 'refused',
    refusal: { code: 'pleat_failed', reason: 'reference' },
  });
  expect(e.live()).toBe(1);
});

it.each([false, true])('repeats both native decisions and the second construction (axiom: %s)', async (axiom) => {
  const e = await engine();
  const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw Error('sheet');
  const right: FoldPleatOp = {
    ...op,
    line: {
      via: 'free',
      through: [
        [0.7, 0],
        [0.7, 1],
      ],
    },
    second: {
      via: 'free',
      through: [
        [0.85, 0],
        [0.85, 1],
      ],
    },
  };
  if (axiom) {
    right.second = { via: 'axiom', axiom: 1, inputs: [
      { kind: 'point', at: [0.85, 0] }, { kind: 'point', at: [0.85, 1] },
    ] };
    right.secondRoot = { n: [1, 0], d: 0.85 };
  }
  const orders = e.orderSelection(sheet.state, right, undefined, { index: 0 });
  if (orders.status !== 'ok') throw Error(JSON.stringify(orders));
  right.resolved = orders.pleat;
  const source = e.step(sheet.state, right);
  if (source.status !== 'ok') throw Error(JSON.stringify(source));
  const repeated = prepareRepeat(e, {
    parent: source.state,
    source: { first: 'pleat', last: 'pleat', revision: 'test' },
    axis: { n: [1, 0], d: 0.5 },
    steps: [
      { id: 'pleat', before: sheet.state, after: source.state, op: right },
    ],
  });
  expect(repeated, JSON.stringify(repeated)).toMatchObject({ status: 'ready' });
  if (repeated.status !== 'ready') return;
  const result = e.step(source.state, repeated.op);
  if (result.status !== 'ok') throw Error(JSON.stringify(result));
  expect(e.scene(result.state).creases.filter((c) => c.letter)).toHaveLength(4);
  e.release([result.state, source.state]);
  expect(e.live()).toBe(1);
});

it.each([-1, 1])('folds a slightly tilted valley (%i) exactly as drawn and replays its saved orders', async (sign) => {
  const e = await engine();
  const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw Error('sheet');
  // Two quarter-width flaps meet over a middle panel: a generic three-layer
  // strip, independent of any private model. A tiny tilt makes the returning
  // flap overlap the opposite stationary panel by less than MIN_FEATURE.
  const left = e.step(sheet.state, {
    kind: 'valley', line: { via: 'free', through: [[0.25, 0], [0.25, 1]] },
    moving: [0.1, 0.1], seed: { scope: 'all' },
  });
  if (left.status !== 'ok') throw Error(JSON.stringify(left));
  const right = e.step(left.state, {
    kind: 'valley', line: { via: 'free', through: [[0.75, 0], [0.75, 1]] },
    moving: [0.9, 0.1], seed: { scope: 'all' },
  });
  if (right.status !== 'ok') throw Error(JSON.stringify(right));
  const tilted: FoldPleatOp = {
    kind: 'pleat', line: { via: 'free', through: [[0.3, 0.55], [0.7, 0.55]] },
    second: { via: 'free', through: [[0.3, 0.5 + sign * 0.0006], [0.7, 0.5 - sign * 0.0006]] },
    moving: [0.5, 0.3], seed: { scope: 'all' },
  };
  const original = JSON.stringify(tilted), live = e.live();
  const orders = e.orderSelection(right.state, tilted, undefined, { index: 0 });
  expect(orders).toMatchObject({ status: 'ok', count: { orders: 1, exact: true } });
  expect(JSON.stringify(tilted)).toBe(original);
  expect(e.live()).toBe(live);
  if (orders.status !== 'ok') return;
  const saved = { ...tilted, resolved: orders.pleat };
  const folded = e.step(right.state, saved), replay = e.step(right.state, JSON.parse(JSON.stringify(saved)));
  if (folded.status !== 'ok' || replay.status !== 'ok') throw Error('angled pleat failed');
  expect(replay.fingerprint).toBe(folded.fingerprint);
  e.release([folded.state, replay.state]);
  expect(e.live()).toBe(live);
});

it('resolves the second axiom on the original pose, replays its root, and refuses a stale root', async () => {
  const e = await engine();
  const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw Error('sheet');
  const second = { via: 'axiom', axiom: 2, inputs: [
    { kind: 'point', at: [0.6, 0.5] }, { kind: 'point', at: [0.9, 0.5] },
  ] } as const;
  const roots = e.axiomCandidates(sheet.state, second);
  if (roots.status !== 'ok') throw Error(JSON.stringify(roots));
  const rooted: FoldPleatOp = { ...op, second, secondRoot: roots.candidates[0]!.line };
  const folded = e.step(sheet.state, rooted), free = e.step(sheet.state, op);
  if (folded.status !== 'ok' || free.status !== 'ok') throw Error(JSON.stringify(folded));
  expect(folded.fingerprint).toBe(free.fingerprint);
  const replay = e.step(sheet.state, JSON.parse(JSON.stringify(rooted)));
  expect(replay).toMatchObject({ status: 'ok', fingerprint: folded.fingerprint });
  expect(e.step(sheet.state, { ...rooted, secondRoot: { n: [1, 0], d: 0.7 } }))
    .toMatchObject({ status: 'refused', refusal: { code: 'pleat_failed', reason: 'reference' } });
});

import { foldNodeDigest, foldPathDigest } from '../document/foldDigest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import type { FoldOp } from '../document/foldSequenceDocument';
import { prepareRepeat, type RepeatSourceStep } from './repeatPreparation';
import { repeatSymmetries, verifiedSymmetry } from './repeatGeometry';
import { appendFoldStep, appendFoldSteps } from '../document/foldSequenceEdits';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import { resolveFoldReturn } from '../document/foldReturn';
import type { FoldRefusalBody } from '../engine/foldEngineWire';

async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({
    module: readFileSync(
      resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm'),
    ),
  });
  const raw = new wasm.FoldEngine();
  return { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
}
const axis = { n: [1, 0] as const, d: 0.5 };
describe('sequential Repeat through the public engine', () => {
  it.each([
    { code: 'choice_needed', choice: 'completion' },
    { code: 'choice_broken', broken: 'not_unique', orders: { orders: 2, exact: true } },
  ] satisfies FoldRefusalBody[])('resolves a remaining completion after $code', async (refusal) => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('sheet');
    const op: FoldOp = {
      kind: 'valley',
      line: { via: 'free', through: [[0.6, 1], [1, 0.6]] },
      moving: [0.95, 0.95],
      seed: { scope: 'all' },
    };
    const source = e.step(sheet.state, op);
    if (source.status !== 'ok') throw new Error(JSON.stringify(source));
    const request = {
      parent: source.state, axis,
      steps: [{ id: 'corner', before: sheet.state, after: source.state, op }],
      source: { first: 'corner', last: 'corner', revision: 'test' },
    };
    const expected = prepareRepeat(e, request);
    if (expected.status !== 'ready') throw new Error(JSON.stringify(expected));
    let attempts = 0;
    // Exercise both public refusal envelopes at the preparation boundary. All
    // candidates and their replay still come from the native order solver.
    const prepared = prepareRepeat({ ...e, step: (...args) => {
      if (attempts++ === 0) return { status: 'refused', refusal, fixes: [], faces: [], vertices: [] };
      return e.step(...args);
    } }, request);
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    expect(prepared.op.steps.at(-1)!.expect).toBe(expected.op.steps.at(-1)!.expect);
    expect(e.step(source.state, prepared.op).status).toBe('ok');
  });

  it('repeats a precrease then a fold, with identical grouped/individual replay and no leaked trial states', async () => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error(JSON.stringify(sheet));
    expect(repeatSymmetries(e.scene(sheet.state), sheet.summary.sheet)).toHaveLength(4);
    const ops: FoldOp[] = [
      {
        kind: 'precrease',
        direction: 'valley',
        line: {
          via: 'free',
          through: [
            [0.75, 0],
            [0.75, 1],
          ],
        },
        moving: [0.9, 0.5],
        seed: { scope: 'all' },
      },
      {
        kind: 'valley',
        line: {
          via: 'free',
          through: [
            [0.6, 1],
            [1, 0.6],
          ],
        },
        moving: [0.95, 0.95],
        seed: { scope: 'all' },
      },
    ];
    const steps: RepeatSourceStep[] = [];
    let current = sheet.state;
    for (const [i, op] of ops.entries()) {
      const result = e.step(current, op);
      if (result.status !== 'ok') throw new Error(JSON.stringify(result));
      steps.push({ id: `s${i}`, before: current, after: result.state, op });
      current = result.state;
    }
    const count = e.live();
    const prepared = prepareRepeat(e, {
      parent: current,
      axis,
      steps,
      source: { first: 's0', last: 's1', revision: 'test' },
    });
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'ready' });
    expect(e.live()).toBe(count);
    if (prepared.status !== 'ready') return;
    const original = {
      formatVersion: 1 as const,
      id: 'repeat-test',
      title: '',
      paper: { shape: { kind: 'square' as const }, startSide: 'front' as const },
      steps: steps.map((s, i) => ({ id: s.id, parent: i ? steps[i - 1]!.id : null, op: s.op })),
    };
    const appended = appendFoldStep(original, { parent: 's1', op: prepared.op });
    expect(appended).not.toBeNull();
    const expanded = appendFoldSteps(original, 's1', prepared.op.steps);
    expect(expanded?.document.steps).toHaveLength(4);
    const read = readFoldSequence(
      JSON.parse(JSON.stringify(writeFoldSequence({ document: appended!.document, readOnlyRaw: null }))),
    );
    expect(read?.document.steps.at(-1)?.op?.kind).toBe('repeat');
    const fresh = await engine();
    const freshSheet = fresh.sheet(original.paper);
    if (freshSheet.status !== 'ok') throw new Error('sheet');
    let freshParent = freshSheet.state;
    for (const node of read!.document.steps) {
      if (!node.op) throw new Error('locked step');
      const result = fresh.step(freshParent, node.op, node.choices);
      if (result.status !== 'ok') throw new Error(JSON.stringify(result));
      freshParent = result.state;
    }
    expect(fresh.fingerprint(freshParent)).toBe(prepared.op.steps.at(-1)!.expect);
    const alive = e.live();
    expect(e.step(sheet.state, prepared.op)).toMatchObject({
      status: 'refused',
      refusal: { code: 'repeat_failed', reason: 'repeat_parent_changed' },
    });
    const bad = {
      ...prepared.op,
      steps: prepared.op.steps.map((entry, i) => (i === 1 ? { ...entry, expect: 'fs1:incorrect' } : entry)),
    };
    expect(e.step(current, bad)).toMatchObject({
      status: 'refused',
      refusal: { code: 'repeat_failed', reason: 'repeat_step_changed', step: 1 },
    });
    expect(e.live()).toBe(alive);
    const grouped = e.step(current, prepared.op);
    expect(grouped).toMatchObject({ status: 'ok' });
    for (const entry of prepared.op.steps) {
      const result = e.step(current, entry.op, entry.choices);
      if (result.status !== 'ok') throw new Error(JSON.stringify(result));
      expect(result.fingerprint).toBe(entry.expect);
      current = result.state;
    }
    if (grouped.status !== 'ok') return;
    expect(e.fingerprint(current)).toBe(grouped.fingerprint);
    const back = e.returnTo(grouped.state, sheet.state, [
      sheet.state,
      ...steps.map((s) => s.after),
      grouped.state,
    ]);
    expect(back).toMatchObject({ status: 'ok' });
    e.release([grouped.state]);
    expect(() => e.scene(current)).not.toThrow();
  });

  it.each(['inserted valley', 'inside reverse'] as const)(
    'preserves the %s on the matching end of a folded book',
    async (kind) => {
      const e = await engine();
      const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
      if (sheet.status !== 'ok') throw new Error('sheet');
      const book = e.step(sheet.state, {
        kind: 'valley',
        line: {
          via: 'free',
          through: [
            [0.5, 0],
            [0.5, 1],
          ],
        },
        moving: [0.75, 0.5],
        seed: { scope: 'all' },
      });
      if (book.status !== 'ok') throw new Error(JSON.stringify(book));
      const op: FoldOp =
        kind === 'inserted valley'
          ? {
              kind: 'valley',
              line: {
                via: 'free',
                through: [
                  [0, 0.3],
                  [0.3, 0],
                ],
              },
              moving: [0.05, 0.05],
              seed: { scope: 'flaps', at: [[0.05, 0.05]] },
              landing: { kind: 'against', targets: [[0.75, 0.5]] },
            }
          : {
              kind: 'inside-reverse',
              line: {
                via: 'free',
                through: [
                  [0, 0.2],
                  [0.5, 0.2],
                ],
              },
              moving: [0.1, 0.1],
              seed: { scope: 'all' },
            };
      const one = e.step(book.state, op);
      if (one.status !== 'ok') throw new Error(JSON.stringify(one));
      const prepared = prepareRepeat(e, {
        parent: one.state,
        axis: { n: [0, 1], d: 0.5 },
        steps: [{ id: 'end', before: book.state, after: one.state, op }],
        source: { first: 'end', last: 'end', revision: 'test' },
      });
      expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'ready' });
      if (prepared.status === 'ready') expect(e.step(one.state, prepared.op)).toMatchObject({ status: 'ok' });
    },
  );

  it('refuses a range that already folds across the destination, without changing source states', async () => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('sheet');
    const op: FoldOp = {
      kind: 'valley',
      line: {
        via: 'free',
        through: [
          [0.5, 0],
          [0.5, 1],
        ],
      },
      moving: [0.9, 0.5],
      seed: { scope: 'all' },
    };
    const result = e.step(sheet.state, op);
    if (result.status !== 'ok') throw new Error('book');
    const count = e.live();
    const answer = prepareRepeat(e, {
      parent: result.state,
      axis,
      source: { first: 'a', last: 'a', revision: 'test' },
      steps: [{ id: 'a', before: sheet.state, after: result.state, op }],
    });
    expect(answer.status).toBe('blocked');
    expect(e.live()).toBe(count);
    expect(e.fingerprint(result.state)).toBe(result.fingerprint);
  });

  it('repeats an unfold-to within the range and remaps its target when saved as individual steps', async () => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('sheet');
    const fold: FoldOp = {
      kind: 'valley',
      line: {
        via: 'free',
        through: [
          [0.6, 1],
          [1, 0.6],
        ],
      },
      moving: [0.95, 0.95],
      seed: { scope: 'all' },
    };
    const first = e.step(sheet.state, fold);
    if (first.status !== 'ok') throw new Error('fold');
    const back = e.returnTo(first.state, sheet.state, [sheet.state, first.state]);
    if (back.status !== 'ok') throw new Error(JSON.stringify(back));
    const unfold: FoldOp = {
      kind: 'unfold-to',
      target: null,
      source: {
        path: foldPathDigest({ shape: { kind: 'square' }, startSide: 'front' }, [
          { id: 'a', parent: null, op: fold },
        ]),
        state: first.fingerprint,
        targetState: sheet.fingerprint,
      },
    };
    const prepared = prepareRepeat(e, {
      parent: back.state,
      baseline: null,
      axis,
      source: { first: 'a', last: 'b', revision: 'fh1:test' },
      steps: [
        { id: 'a', before: sheet.state, after: first.state, op: fold },
        { id: 'b', before: first.state, after: back.state, op: unfold },
      ],
    });
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'ready' });
    if (prepared.status !== 'ready') return;
    const saved = readFoldSequence(
      JSON.parse(
        JSON.stringify(
          writeFoldSequence({
            document: {
              formatVersion: 2,
              id: 'history-repeat',
              title: '',
              paper: { shape: { kind: 'square' }, startSide: 'front' },
              steps: [{ id: 'r', parent: null, op: prepared.op }],
            },
            readOnlyRaw: null,
          }),
        ),
      ),
    )!;
    const readOp = saved.document.steps[0]!.op;
    if (!readOp) throw new Error('unreadable history recipe');
    const grouped = e.step(back.state, readOp);
    expect(grouped).toMatchObject({ status: 'ok' });
    const document = {
      formatVersion: 2 as const,
      id: 'returns',
      title: '',
      paper: { shape: { kind: 'square' as const }, startSide: 'front' as const },
      steps: [
        { id: 'a', parent: null, op: fold, expect: first.fingerprint },
        { id: 'b', parent: 'a', op: unfold, expect: back.fingerprint },
      ],
    };
    const individual = appendFoldSteps(document, 'b', prepared.op.steps)!;
    expect(individual).not.toBeNull();
    const last = individual.document.steps.at(-1)!;
    expect(last.op).toMatchObject({ kind: 'unfold-to', target: 'b' });
    const freshSheet = e.sheet(document.paper);
    if (freshSheet.status !== 'ok') throw new Error('sheet');
    let state = freshSheet.state;
    const sheetNode = {
      state: state,
      fingerprint: freshSheet.fingerprint,
      status: 'ok' as const,
      path: foldPathDigest(document.paper, []),
    };
    const states = new Map<string, typeof sheetNode>();
    for (const node of individual.document.steps) {
      if (!node.op) throw new Error('locked');
      let result;
      if (node.op.kind === 'unfold-to') {
        const dependency = resolveFoldReturn(individual.document, node.parent, node.op, sheetNode, states);
        if ('code' in dependency) throw new Error(dependency.code);
        result = e.returnTo(state, dependency.target, dependency.history);
      } else result = e.step(state, node.op, node.choices);
      if (result.status !== 'ok') throw new Error(JSON.stringify(result));
      states.set(node.id, {
        state: result.state,
        fingerprint: result.fingerprint,
        status: 'ok',
        path: foldNodeDigest(individual.document, node.id)!,
      });
      state = result.state;
    }
    if (grouped.status === 'ok') expect(e.fingerprint(state)).toBe(grouped.fingerprint);
  });

  it.each(['front', 'back'] as const)(
    'matches independent mirrored folds on %s paper in a rotated, turned view',
    async (startSide) => {
      const e = await engine();
      const sheet = e.sheet({ shape: { kind: 'square' }, startSide });
      if (sheet.status !== 'ok') throw new Error('sheet');
      const turned = e.step(sheet.state, { kind: 'turn', axis: 'vertical' });
      if (turned.status !== 'ok') throw new Error('turn');
      const rotated = e.step(turned.state, {
        kind: 'rotate',
        rotate: { direction: 'ccw', amount: 'degrees', degrees: 37 },
      });
      if (rotated.status !== 'ok') throw new Error(JSON.stringify(rotated));
      const a: FoldOp = {
        kind: 'precrease',
        direction: 'mountain',
        line: {
          via: 'free',
          through: [
            [0.75, 0],
            [0.75, 1],
          ],
        },
        moving: [0.9, 0.5],
        seed: { scope: 'all' },
      };
      const b: FoldOp = {
        kind: 'mountain',
        line: { via: 'crease', at: [0.75, 0.4] },
        moving: [0.9, 0.5],
        seed: { scope: 'all' },
      };
      const one = e.step(rotated.state, a);
      if (one.status !== 'ok') throw new Error('precrease');
      const two = e.step(one.state, b);
      if (two.status !== 'ok') throw new Error('existing crease');
      const prepared = prepareRepeat(e, {
        parent: two.state,
        axis,
        source: { first: 'a', last: 'b', revision: 'test' },
        steps: [
          { id: 'a', before: rotated.state, after: one.state, op: a },
          { id: 'b', before: one.state, after: two.state, op: b },
        ],
      });
      expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'ready' });
      if (prepared.status !== 'ready') return;
      const expectedPrecrease = e.step(two.state, {
        ...a,
        line: {
          via: 'free',
          through: [
            [0.25, 0],
            [0.25, 1],
          ],
        },
        moving: [0.1, 0.5],
      });
      if (expectedPrecrease.status !== 'ok') throw new Error('mirror precrease');
      expect(prepared.op.steps[0]!.expect).toBe(expectedPrecrease.fingerprint);
      const expectedFold = e.step(expectedPrecrease.state, {
        ...b,
        line: { via: 'crease', at: [0.25, 0.4] },
        moving: [0.1, 0.5],
        seed: { scope: 'flaps', at: [[0.1, 0.5]] },
      });
      if (expectedFold.status !== 'ok') throw new Error(JSON.stringify(expectedFold));
      expect(prepared.op.steps[1]!.expect).toBe(expectedFold.fingerprint);
    },
  );

  it('mirrors finite precreases across an oblique axis without extending their material extent', async () => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('sheet');
    const op: FoldOp = {
      kind: 'precrease',
      direction: 'valley',
      line: {
        via: 'free',
        through: [
          [0.75, 0],
          [0.75, 1],
        ],
      },
      moving: [0.9, 0.9],
      seed: { scope: 'all' },
      extent: {
        kind: 'segment',
        from: { kind: 'point', at: [0.75, 0.7] },
        to: { kind: 'point', at: [0.75, 0.9] },
      },
    };
    const one = e.step(sheet.state, op);
    if (one.status !== 'ok') throw new Error(JSON.stringify(one));
    const prepared = prepareRepeat(e, {
      parent: one.state,
      axis: { n: [Math.SQRT1_2, Math.SQRT1_2], d: Math.SQRT1_2 },
      source: { first: 'a', last: 'a', revision: 'test' },
      steps: [{ id: 'a', before: sheet.state, after: one.state, op }],
    });
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'ready' });
    if (prepared.status !== 'ready') return;
    expect(prepared.op.steps[0]!.op).toMatchObject({
      extent: {
        kind: 'segment',
        from: { at: [expect.closeTo(0.3, 8), expect.closeTo(0.25, 8)] },
        to: { at: [expect.closeTo(0.1, 8), expect.closeTo(0.25, 8)] },
      },
    });
    expect(e.step(one.state, prepared.op)).toMatchObject({ status: 'ok' });
  });

  // A kite base mirrored across its diagonal. The axiom's first input starts
  // at the tip, where the body and both flaps meet, and both its roots cross
  // the paper: a frame read through the wrong flap there took the other root.
  it.each([
    ['bottom flap first', 0],
    ['bottom flap first', 1],
    ['left flap first', 0],
    ['left flap first', 1],
  ] as const)(
    'mirrors an axiom root read at a vertex of differently placed faces (%s, root %i)',
    async (order, root) => {
      const e = await engine();
      const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
      if (sheet.status !== 'ok') throw new Error('sheet');
      const t = Math.SQRT2 - 1;
      const bottom: FoldOp = {
        kind: 'valley',
        line: { via: 'free', through: [[0, 0], [1, t]] },
        moving: [0.9, 0.1],
        seed: { scope: 'all' },
      };
      const left: FoldOp = {
        kind: 'valley',
        line: { via: 'free', through: [[0, 0], [t, 1]] },
        moving: [0.1, 0.9],
        seed: { scope: 'all' },
      };
      const across: FoldOp = {
        kind: 'precrease',
        direction: 'valley',
        line: { via: 'free', through: [[0.9, 0.3], [0.3, 0.9]] },
        moving: [0.9, 0.9],
        seed: { scope: 'all' },
      };
      let base = sheet.state;
      for (const op of order === 'bottom flap first' ? [bottom, left, across] : [left, bottom, across]) {
        const landed = e.step(base, op);
        if (landed.status !== 'ok') throw new Error(JSON.stringify(landed));
        base = landed.state;
      }
      // Sheet ↔ model is the identity on the kite's body, so the diagonal
      // mirrors sheet points and model lines alike.
      const swap = ([x, y]: readonly [number, number]) => [y, x] as const;
      const axis = { n: [-Math.SQRT1_2, Math.SQRT1_2] as const, d: 0 };
      const crossing = [1.2 / (1 + t), (1.2 * t) / (1 + t)] as const;
      const line = (s: (p: readonly [number, number]) => readonly [number, number]) =>
        ({
          via: 'axiom',
          axiom: 3,
          inputs: [
            { kind: 'edge', a: s([0, 0]), b: s(crossing) },
            { kind: 'edge', a: s(crossing), b: s([0.6, 0.6]) },
          ],
        }) as const;
      const roots = e.axiomCandidates(base, line((p) => p));
      if (roots.status !== 'ok') throw new Error(JSON.stringify(roots));
      expect(roots.candidates).toHaveLength(2);
      const chosen = roots.candidates[root]!.line;
      // A segment from the crossing, 0.2 along the root into the kite's body below the diagonal.
      const end = [0.2, -0.2]
        .map((k) => [crossing[0] - k * chosen.n[1], crossing[1] + k * chosen.n[0]] as const)
        .find(([x, y]) => y > t * x && y < x)!;
      const precrease = (s: (p: readonly [number, number]) => readonly [number, number]): FoldOp => ({
        kind: 'precrease',
        direction: 'valley',
        line: line(s),
        moving: s([0.9, 0.2]),
        seed: { scope: 'all' },
        extent: { kind: 'segment', from: { kind: 'point', at: s(crossing) }, to: { kind: 'point', at: s(end) } },
      });
      const op = precrease((p) => p);
      const source = e.step(base, op, { root: chosen });
      if (source.status !== 'ok') throw new Error(JSON.stringify(source));
      const prepared = prepareRepeat(e, {
        parent: source.state,
        axis,
        source: { first: 'a', last: 'a', revision: 'test' },
        steps: [{ id: 'a', before: base, after: source.state, op, choices: { root: chosen } }],
      });
      expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'ready' });
      if (prepared.status !== 'ready') return;
      expect(prepared.op.steps[0]!.choices?.root).toMatchObject({
        n: [expect.closeTo(chosen.n[1], 9), expect.closeTo(chosen.n[0], 9)],
        d: expect.closeTo(chosen.d, 9),
      });
      // The same state as folding the mirror by hand.
      const byHand = e.step(source.state, precrease(swap), { root: { n: swap(chosen.n), d: chosen.d } });
      if (byHand.status !== 'ok') throw new Error(JSON.stringify(byHand));
      expect(prepared.op.steps[0]!.expect).toBe(byHand.fingerprint);
      // Its marks are the source's, mirrored.
      const key = (letter: string, ends: (readonly [number, number])[]) =>
        `${letter} ${ends.map((p) => p.map((v) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(9)).join(',')).sort().join(' ')}`;
      const added = (from: number, to: number, s: (p: readonly [number, number]) => readonly [number, number]) => {
        const old = new Set((e.scene(from).crease_marks ?? []).map((m) => key(m.letter, [[m.from.x, m.from.y], [m.to.x, m.to.y]])));
        return (e.scene(to).crease_marks ?? [])
          .filter((m) => !old.has(key(m.letter, [[m.from.x, m.from.y], [m.to.x, m.to.y]])))
          .map((m) => key(m.letter, [s([m.from.x, m.from.y]), s([m.to.x, m.to.y])]))
          .sort();
      };
      const mirrored = added(base, source.state, swap);
      expect(mirrored.length).toBeGreaterThan(0);
      const grouped = e.step(source.state, prepared.op);
      if (grouped.status !== 'ok') throw new Error(JSON.stringify(grouped));
      expect(added(source.state, grouped.state, (p) => p)).toEqual(mirrored);
    },
  );

  it('rejects an otherwise symmetric silhouette with incompatible hidden layer relationships', async () => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('sheet');
    const one = e.step(sheet.state, {
      kind: 'valley',
      line: {
        via: 'free',
        through: [
          [0.5, 0],
          [0.5, 1],
        ],
      },
      moving: [0.9, 0.5],
      seed: { scope: 'all' },
    });
    if (one.status !== 'ok') throw new Error('book');
    const scene = e.scene(one.state),
      axis = { n: [0, 1] as const, d: 0.5 };
    expect(verifiedSymmetry(scene, axis)).not.toBeNull();
    // One asymmetric flat subdivision; changing only one subface's stack must
    // invalidate the match even though every vertex and exposed outline stays put.
    const marked = e.step(one.state, {
      kind: 'precrease',
      direction: 'valley',
      line: {
        via: 'free',
        through: [
          [0, 0.2],
          [0.5, 0.2],
        ],
      },
      moving: [0.1, 0.1],
      seed: { scope: 'all' },
    });
    if (marked.status !== 'ok') throw new Error('precrease');
    const physical = e.scene(marked.state);
    expect(verifiedSymmetry(physical, axis)).not.toBeNull();
    const wrong = {
      ...physical,
      subfaces: physical.subfaces.map((cell, i) =>
        i === 0 ? { ...cell, faces_top_to_bottom: [...cell.faces_top_to_bottom].reverse() } : cell,
      ),
    };
    expect(verifiedSymmetry(wrong, axis)).toBeNull();
  });
});

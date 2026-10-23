import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFoldReplayer } from '../document/foldReplay';
import type { FoldChoices, FoldOp, FoldPaper } from '../document/foldSequenceDocument';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEnginePort, type FoldEngineSource } from './foldEnginePort';
import {
  FOLD_REFUSAL_CODES,
  type FoldAxiomLine,
  type FoldEngineOp,
  type FoldEngineOutcome,
  type FoldEngineRefused,
} from './foldEngineWire';

/**
 * The Fold engine's calls over the real bridge, in-process: exactly what
 * `workers/foldSequenceWorker.ts` runs, minus comlink.
 *
 * The crate's own tests prove the engine and the bridge natively; what
 * neither covers is the wasm boundary itself — that the document's ops cross
 * it as the Rust wire types expect, that refusals come back as codes this
 * side knows, that handles and fingerprints behave, that every query answers
 * in the shapes `foldEngineWire.ts` declares — and that the engine's classic
 * sequences, driven from TypeScript, land the outcomes its fixtures record.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
// Vitest runs with `apps/web` as its root; `import.meta.url` is not a file
// URL under jsdom, so the paths are resolved from there rather than from the
// module.
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CLASSICS = resolve(ROOT, '../../crates/oristudio-fold/tests/fixtures/classics');
const available = existsSync(WASM) && existsSync(CLASSICS);

const SQUARE: FoldPaper = { shape: { kind: 'square' }, startSide: 'front' };

/** G1's book fold, as the document stores it: x = 0.5, the right half over the left. */
const BOOK: FoldOp = {
  kind: 'valley',
  line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
  moving: [0.75, 0.5],
  seed: { scope: 'all' },
};

/** O2, corner onto corner: the line y = x, the corner (1, 0) carried across it, which says the side. */
const CORNER_TO_CORNER: FoldAxiomLine = {
  via: 'axiom',
  axiom: 2,
  inputs: [
    { kind: 'point', at: [1, 0] },
    { kind: 'mark', at: [0, 1], mark: 'fmark-1' },
  ],
};

async function engine(): Promise<{ calls: FoldEngineCalls; version: number }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return { calls: createFoldEngineCalls(new wasm.FoldEngine()), version: wasm.fold_engine_version() };
}

/** The calls as a port's source: one engine, one generation. */
function sourceOf(calls: FoldEngineCalls): FoldEngineSource {
  return {
    generation: () => 0,
    sheet: async (paper) => calls.sheet(paper),
    step: async (state, op, choices) => calls.step(state, op, choices),
    release: async (states) => calls.release(states),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

function refused<T>(outcome: FoldEngineOutcome<T>): FoldEngineRefused {
  if (outcome.status !== 'refused') throw new Error('landed');
  return outcome;
}

function sheetOf(calls: FoldEngineCalls, paper: FoldPaper = SQUARE): number {
  return landed(calls.sheet(paper)).state;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('did not throw');
}

describe.skipIf(!available)('the Fold engine over the real bridge', () => {
  it('replays a document through the port, every state with an fs1 fingerprint', async () => {
    const { calls, version } = await engine();
    const port = createFoldEnginePort(sourceOf(calls), version);
    expect(port.engineVersion).toBeGreaterThanOrEqual(1);
    const fs1 = /^fs1:[0-9a-f]{16}$/;

    const sheet = await port.sheet(SQUARE);
    if (!sheet.landed) throw new Error(sheet.code);
    expect(sheet.fingerprint).toMatch(fs1);
    const steps: FoldOp[] = [
      BOOK,
      // Unfold the flap along the bend, picked by depth.
      {
        kind: 'unfold',
        crease: [0.5, 0.5],
        direction: 'valley',
        seed: { scope: 'depth', at: [0.25, 0.5], layers: 1 },
      },
      // Refold the crease the unfold left flat.
      {
        kind: 'refold',
        crease: [0.5, 0.5],
        direction: 'valley',
        moving: [0.75, 0.5],
        seed: { scope: 'all' },
      },
      { kind: 'turn', axis: 'horizontal' },
      { kind: 'rotate', rotate: { amount: 'eighth', direction: 'cw' } },
      {
        kind: 'precrease',
        direction: 'mountain',
        line: { via: 'free', through: [[0.1, 0.5], [0.4, 0.5]] },
        moving: [0.25, 0.75],
        seed: { scope: 'all' },
      },
    ];
    let state = sheet.state;
    const fingerprints = [sheet.fingerprint];
    for (const op of steps) {
      const outcome = await port.step(state, { op });
      if (!outcome.landed) throw new Error(`${op.kind}: ${outcome.code}`);
      expect(outcome.fingerprint).toMatch(fs1);
      fingerprints.push(outcome.fingerprint);
      state = outcome.state;
    }
    // Unfolding the flap and refolding it is the book again, crease for
    // crease and pair for pair: the fingerprint says so. Every other state
    // differs.
    expect(fingerprints[3]).toBe(fingerprints[1]);
    expect(new Set(fingerprints).size).toBe(fingerprints.length - 1);
    const summary = calls.summary(state.id);
    expect(summary.step).toBe(steps.length);
    expect(summary.view.flipped).toBe(true);
    // The precrease through both layers is two flat creases, and it splits
    // the bend and the edges it crosses in two.
    expect(summary.creases).toEqual({ border: 8, mountain: 0, valley: 2, flat: 2 });
  });

  it('replays an axiom step along its stored root, through the document’s replayer', async () => {
    const { calls, version } = await engine();
    const sheet = sheetOf(calls);
    const { candidates } = landed(calls.axiomCandidates(sheet, CORNER_TO_CORNER));
    expect(candidates).toHaveLength(1);
    const [chosen] = candidates;
    if (!chosen) throw new Error('no candidate');
    expect(chosen.side).not.toBeNull();
    calls.release([sheet]);

    const fold: FoldOp = { kind: 'valley', line: CORNER_TO_CORNER, seed: { scope: 'all' } };
    const replayer = createFoldReplayer(createFoldEnginePort(sourceOf(calls), version));
    const sequence = sequenceOf([step('fstep-1', null, fold, { choices: { root: chosen.line } })]);
    const done = await replayer.run({ loadId: 1, sequence });
    const node = done?.steps.get('fstep-1');
    expect(node?.status).toBe('ok');
    if (!node?.state) throw new Error('not landed');
    expect(calls.summary(node.state.id).faces).toBe(2);

    // Without its root the step breaks, by the bridge's code.
    const rootless = await createFoldReplayer(createFoldEnginePort(sourceOf(calls), version)).run({
      loadId: 1,
      sequence: sequenceOf([step('fstep-1', null, fold)]),
    });
    expect(rootless?.steps.get('fstep-1')?.refusal).toEqual({ at: 'fstep-1', code: 'root_missing' });
  });

  it('lands the same fingerprints from the same path in another engine', async () => {
    const one = (await engine()).calls;
    const two = (await engine()).calls;
    // The second engine has handles already spent: numbering never reaches the key.
    sheetOf(two);
    const book = (calls: FoldEngineCalls) => landed(calls.step(sheetOf(calls), BOOK));
    const [a, b] = [book(one), book(two)];
    expect(a.state).not.toBe(b.state);
    expect(a.fingerprint).toBe(b.fingerprint);
    const mountain = landed(one.step(sheetOf(one), { ...BOOK, kind: 'mountain' }));
    expect(mountain.fingerprint).not.toBe(a.fingerprint);
  });

  it('replays the engine’s classic sequences to the outcomes their fixtures record', async () => {
    const { calls } = await engine();
    const files = readdirSync(CLASSICS)
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(resolve(CLASSICS, file), 'utf8')) as ClassicFixture;
      let state = sheetOf(calls, {
        shape: { kind: 'square' },
        startSide: fixture.start,
      });
      expect(fixture.sheet.shape).toBe('square');
      for (const [k, [recorded, expected]] of fixture.steps.entries()) {
        const step = landed(calls.step(state, classicOp(recorded)));
        const where = `${file} step ${k}`;
        expect(step.summary.faces, where).toBe(expected.faces);
        expect(step.summary.pairs, where).toBe(expected.pairs);
        expect(step.report?.moving.length ?? 0, where).toBe(expected.moved);
        const count = (kind: string, letter?: string) =>
          expected.creases.filter(
            (c) => c.kind.kind === kind && (letter === undefined || c.kind.letter === letter)
          ).length;
        expect(step.summary.creases, where).toEqual({
          border: count('border'),
          mountain: count('folded', 'mountain'),
          valley: count('folded', 'valley'),
          flat: count('flat'),
        });
        expect(calls.release([state])).toBe(1);
        state = step.state;
      }
    }
  });

  it('refuses with codes this side knows, fixes included, and never a sentence', async () => {
    const { calls } = await engine();
    const book = landed(calls.step(sheetOf(calls), BOOK)).state;

    // Everything left of x = 0.5 is both layers: nothing stays; pick a flap.
    const everything = refused(calls.apply(book, { ...BOOK, moving: [0.25, 0.5] }));
    expect(everything.refusal).toEqual({ code: 'nothing_stays' });
    expect(everything.fixes.map((fix) => fix.fix)).toEqual(['pick_flap']);

    // A near miss offers the landmark line, which folds as given.
    const strip = sheetOf(calls, { shape: { kind: 'rectangle', aspect: [1, 0.5] }, startSide: 'front' });
    const folded = landed(
      calls.step(strip, {
        kind: 'valley',
        line: { via: 'model', line: { n: [1, 0], d: 0.3 } },
        side: 'negative',
        seed: { scope: 'all' },
      })
    ).state;
    const near = refused(
      calls.apply(folded, {
        kind: 'valley',
        line: { via: 'model', line: { n: [1, 0], d: 0.6 - 1e-4 } },
        side: 'positive',
        seed: { scope: 'all' },
      })
    );
    expect(near.refusal.code).toBe('near_miss');
    expect(near.vertices).toHaveLength(1);
    const [fix] = near.fixes;
    if (fix?.fix !== 'use_line') throw new Error(JSON.stringify(near.fixes));
    expect(fix.line.d).toBeCloseTo(0.6, 9);
    expect(fix.step).toBeUndefined();
    landed(
      calls.apply(folded, {
        kind: 'valley',
        line: { via: 'model', line: fix.line },
        side: fix.side,
        seed: { scope: 'all' },
      })
    );

    // This narrow image overlap is fully resolved: preserve the requested
    // line rather than offering a different fold to avoid it.
    const narrow = landed(calls.apply(folded, {
      kind: 'valley', line: { via: 'free', through: [[0.79995, 0], [0.79995, 0.5]] },
      moving: [0.9, 0.25], seed: { scope: 'all' },
    }));
    expect(narrow.summary.pairs).toBe(3);

    const refold: FoldOp = {
      kind: 'refold',
      crease: [0.5, 0.5],
      direction: 'valley',
      moving: [0.25, 0.5],
      seed: { scope: 'all' },
    };
    const others: [FoldEngineOp, string][] = [
      [{ ...BOOK, line: { via: 'crease', at: [0.3, 0.5] } }, 'crease_not_found'],
      [{ ...BOOK, line: CORNER_TO_CORNER }, 'root_missing'],
      [{ kind: 'cp-jump', cpJson: '{}', orderJson: '{}', origin: 'cp' }, 'import_stored_unreadable'],
      [refold, 'crease_not_flat'],
      [{ ...BOOK, moving: [0.25, 1.5] }, 'point_off_paper'],
      [{ ...BOOK, line: { via: 'free', through: [[0, 0], [1, 0]] }, moving: [0.25, 0.5] }, 'free_line_too_short'],
    ];
    const codes: string[] = [everything.refusal.code, near.refusal.code];
    for (const [op, code] of others) {
      const refusal = refused(calls.apply(book, op));
      expect(refusal.refusal.code, JSON.stringify(op)).toBe(code);
      codes.push(refusal.refusal.code);
      expect(JSON.stringify(refusal)).not.toMatch(/"message"/);
    }
    const completion: FoldChoices['completion'] = {
      faces: [
        [0.1, 0.1],
        [0.9, 0.1],
      ],
      orders: [[0, 1, 1]],
    };
    const choice = refused(calls.apply(book, BOOK, { completion }));
    codes.push(choice.refusal.code);
    expect(choice.refusal).toEqual({ code: 'unexpected_choice', choice: 'completion' });
    const known: readonly string[] = FOLD_REFUSAL_CODES;
    expect(codes.filter((code) => !known.includes(code))).toEqual([]);
  });

  it('analyses without landing, and holds states until they are released', async () => {
    const { calls } = await engine();
    const sheet = sheetOf(calls);
    const book = landed(calls.step(sheet, BOOK)).state;
    expect(calls.live()).toBe(2);
    const { analysis } = landed(
      calls.analyse(book, {
        kind: 'valley',
        line: { via: 'crease', at: [0.5, 0.5] },
        seed: { scope: 'flaps', at: [[0.75, 0.5]] },
      })
    );
    expect(analysis.flaps).toHaveLength(2);
    expect(analysis.picked).toHaveLength(1);
    expect(analysis.moving).toHaveLength(1);
    expect(analysis.line).toEqual({ n: [1, 0], d: 0.5 });
    expect(calls.live()).toBe(2);

    expect(calls.release([sheet, sheet, book])).toBe(2);
    expect(calls.live()).toBe(0);
    expect(calls.release([])).toBe(0);
  });

  it('answers the panes’ and the tools’ queries on a handle', async () => {
    const { calls } = await engine();
    const sheet = sheetOf(calls);

    // A fold's picture before it lands; the step's, and its summary, after.
    const { action: preview } = landed(calls.action(sheet, BOOK));
    expect(preview).toMatchObject({ kind: 'fold', direction: 'valley', moving: [0] });
    expect(preview.grip?.hidden_image).toBeNull();
    const book = landed(calls.step(sheet, BOOK)).state;
    const { action } = landed(calls.stepAction(book));
    expect(action?.grip?.hidden_image).toBe(0);
    expect(action?.line).toEqual(preview.line);
    const { summary } = landed(calls.stepSummary(book));
    expect(summary).toEqual({
      counts: { mountain: 0, valley: 1, flat: 0 },
      diff: { added: [expect.any(Number)], reversed: [], unfolded: [], refolded: [] },
      layers: 1,
    });
    expect(landed(calls.stepSummary(sheet)).summary).toBeNull();
    expect(landed(calls.stepAction(sheet)).action).toBeNull();

    // The scene: the kernel's schema 3, and Fold's own fields.
    const scene = calls.scene(book);
    expect(scene.schema_version).toBe(3);
    expect(scene.fold_schema).toBe(1);
    expect(scene.faces).toHaveLength(2);
    expect(scene.face_transforms).toHaveLength(2);
    // The identity, a rotation by 0 spelling one zero −0.
    expect(scene.view_transform.map((x) => x + 0)).toEqual([1, 0, 0, 0, 1, 0]);
    expect(scene.lineage.map((face) => face.born).sort()).toEqual([1, 1]);
    const valley = scene.creases.filter((crease) => crease.letter === 'valley');
    expect(valley).toHaveLength(1);
    expect(valley[0]).toMatchObject({ kind: 'fold', made_at: 1 });
    expect(Math.max(...scene.subfaces.map((cell) => cell.faces_top_to_bottom.length))).toBe(2);

    // The section across the bend: two rows in one flap, joined where the bend meets the line.
    const { section } = landed(calls.crossSection(book, { n: [0, 1], d: 0.5 }, 'positive'));
    expect(section.rows).toHaveLength(2);
    expect(section.rows.every((row) => row.flap === 0)).toBe(true);
    expect(section.order).toEqual({ kind: 'layered', unordered: [] });
    expect(section.layers).toBe(2);
    expect(section.joins).toEqual([{ upper: 0, lower: 1, at: expect.any(Number) }]);
    // The same line written the other way round, with its side.
    expect(landed(calls.crossSection(book, { n: [0, -1], d: -0.5 }, 'negative')).section).toEqual(section);

    // The top layer at a pick, and the depths a seed there can pick.
    const top = calls.topVisibleAt(book, [0.25, 0.5]);
    expect(top?.sheet[0]).toBeCloseTo(0.75, 12);
    expect(calls.topVisibleAt(book, [3, 3])).toBeNull();
    const corner: FoldEngineOp = {
      kind: 'valley',
      line: { via: 'model', line: { n: [Math.SQRT1_2, Math.SQRT1_2], d: 0.2 * Math.SQRT1_2 } },
      side: 'negative',
      seed: { scope: 'all' },
    };
    const { choices } = landed(calls.depthChoices(book, corner, [0.95, 0.03]));
    expect(choices.map((choice) => choice.layers)).toEqual([1, 2]);

    // Landmarks, with Divide-line marks passed in as sheet points: one on the
    // folded flap, seen; one on the layer under it, hidden.
    const landmarks = calls.landmarks(book, [
      [0.75, 0.25],
      [0.25, 0.25],
    ]);
    const sources = landmarks.points.flatMap((point) => point.sources);
    expect(sources.filter((source) => source.kind === 'mark')).toEqual([
      { kind: 'mark', mark: 0, sheet: [0.75, 0.25], visible: true },
      { kind: 'mark', mark: 1, sheet: [0.25, 0.25], visible: false },
    ]);
    expect(landmarks.segments.some((segment) => segment.kind === 'bend')).toBe(true);

    // A step's queries need its parent.
    calls.release([sheet]);
    expect(thrown(() => calls.stepSummary(book))).toMatchObject({ code: 'parent_released' });
  });

  it('throws the caller’s mistakes as envelopes', async () => {
    const { calls } = await engine();
    const sheet = sheetOf(calls);
    expect(thrown(() => calls.summary(sheet + 100))).toMatchObject({ code: 'unknown_state' });
    expect(thrown(() => calls.step(sheet + 100, BOOK))).toMatchObject({ code: 'unknown_state' });
    expect(thrown(() => calls.apply(1.5, BOOK))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => calls.apply(0, BOOK))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => calls.apply(sheet, { kind: 'valley' } as unknown as FoldEngineOp))).toMatchObject({
      code: 'invalid_input',
    });
    // A side goes with a model line, which has a normal to be on a side of.
    expect(thrown(() => calls.apply(sheet, { ...BOOK, side: 'positive' }))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => calls.analyse(sheet, { kind: 'turn', axis: 'vertical' }))).toMatchObject({
      code: 'invalid_input',
    });
    expect(thrown(() => calls.release([sheet, -1]))).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() => calls.crossSection(sheet, { n: [1, 0], d: 0.5 }, 'left' as unknown as 'positive'))
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => calls.topVisibleAt(sheet, [Number.NaN, 0]))).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() => calls.axiomCandidates(sheet, { via: 'crease', at: [0.5, 0.5] } as unknown as FoldAxiomLine))
    ).toMatchObject({ code: 'invalid_input' });
    // A thrown call lands nothing and releases nothing.
    expect(calls.live()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The engine's classics fixtures (`crates/oristudio-fold/tests/classics.rs`)

interface ClassicFold {
  line: { n: [number, number]; d: number };
  side: 'positive' | 'negative';
  direction: 'valley' | 'mountain';
  seed:
    | { seed: 'all' }
    | { seed: 'depth'; at: [number, number]; layers: number }
    | { seed: 'flaps'; at: [number, number][] };
  placement: { placement: 'on_top' } | { placement: 'over' | 'under'; at: [number, number] };
  closure: 'include' | 'refuse';
}

type ClassicOp = { op: 'fold' | 'precrease'; fold: ClassicFold } | { op: 'turn_over' };

interface ClassicFixture {
  name: string;
  sheet: { shape: string };
  start: 'front' | 'back';
  steps: [
    ClassicOp,
    {
      faces: number;
      pairs: number;
      moved: number;
      creases: { kind: { kind: string; letter?: string } }[];
    },
  ][];
}

/** A recorded engine op as the bridge's op: a model line and its side, as the tools send one. */
function classicOp(recorded: ClassicOp): FoldEngineOp {
  if (recorded.op === 'turn_over') return { kind: 'turn', axis: 'vertical' };
  const { fold } = recorded;
  const seed =
    fold.seed.seed === 'all'
      ? ({ scope: 'all' } as const)
      : fold.seed.seed === 'depth'
        ? ({ scope: 'depth', at: fold.seed.at, layers: fold.seed.layers } as const)
        : ({ scope: 'flaps', at: fold.seed.at } as const);
  const along = {
    line: { via: 'model', line: fold.line } as const,
    side: fold.side,
    seed,
    placement: fold.placement,
    closure: fold.closure,
  };
  return recorded.op === 'precrease'
    ? { kind: 'precrease', direction: fold.direction, ...along }
    : { kind: fold.direction, ...along };
}

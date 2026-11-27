import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { sheetToScene } from '../canvas/foldPicking';
import { foldNodeDigest, type FoldPathDigest } from '../document/foldDigest';
import { isLockedStep, type FoldModelLine, type FoldSequenceDocument, type FoldStep, type SheetPoint } from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import { foldPathEntries } from '../sequence/foldSequencePath';
import { FOLD_PENDING_NODE, type FoldSessionNode } from '../session/foldSessionState';
import { repeatSymmetries } from './repeatGeometry';
import { prepareRepeat } from './repeatPreparation';
import { repeatRange, sameRepeatLine } from './repeatRange';

/**
 * The repeat-after-repeat regression (`tests/fixtures/fold-regressions`): the
 * square's diagonals precreased, its bottom right corner folded onto the
 * center, and that fold repeated across the diagonal y = x, to the top left
 * corner. With that Repeat on screen, Repeat took the Repeat itself as its
 * range, which it never mirrors (`repeat_unsupported`). It now takes the
 * range the Repeat repeated, the corner fold, which repeats again across
 * either center line, onto the center from a corner still flat.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const FIXTURE = resolve(ROOT, '../../tests/fixtures/fold-regressions/repeat-after-repeat.osf');

type Engine = Awaited<ReturnType<typeof engine>>;

async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const raw = new wasm.FoldEngine();
  return { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
}

function opened(): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(FIXTURE, 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error('no sequence');
  return held.document;
}

/** The fixture's one path, folded: its steps, and the sheet's state then each step's. */
function replayed(e: Engine, document: FoldSequenceDocument): { steps: FoldStep[]; states: number[] } {
  const steps = document.steps.filter((step): step is FoldStep => !isLockedStep(step));
  const sheet = e.sheet(document.paper);
  if (sheet.status !== 'ok') throw new Error('sheet');
  const states = [sheet.state];
  for (const step of steps) {
    const landed = e.step(states.at(-1)!, step.op, step.choices);
    if (landed.status !== 'ok') throw new Error(`${step.op.kind}: ${JSON.stringify(landed)}`);
    expect(landed.fingerprint, `${step.op.kind} replays to its stored fingerprint`).toBe(step.expect);
    states.push(landed.state);
  }
  return { steps, states };
}

/** The path Repeat reads its range from (`foldPathEntries`), every step landed. */
function pathOf(e: Engine, document: FoldSequenceDocument, steps: readonly FoldStep[], states: readonly number[]) {
  const landed = (state: number, path: FoldPathDigest | null): FoldSessionNode => ({
    ...FOLD_PENDING_NODE,
    status: 'ok',
    state: { generation: 0, id: state },
    fingerprint: e.fingerprint(state),
    path,
  });
  const nodes = new Map(steps.map((step, k) => [step.id, landed(states[k + 1]!, foldNodeDigest(document, step.id))]));
  return foldPathEntries(document, steps.map((step) => step.id), landed(states[0]!, null), nodes, FOLD_PENDING_NODE);
}

/** Where a sheet point lies once folded, as the folded pane shows it. */
function shown(e: Engine, state: number, sheet: SheetPoint): [number, number] {
  const at = sheetToScene(e.scene(state), sheet);
  if (!at) throw new Error(`${sheet.join(', ')} is not on the paper`);
  return [at.x, at.y];
}

const VERTICAL: FoldModelLine = { n: [1, 0], d: 0.5 };
const HORIZONTAL: FoldModelLine = { n: [0, 1], d: 0.5 };
const CENTER: SheetPoint = [0.5, 0.5];

describe.skipIf(!existsSync(WASM))('a Repeat repeated again (tests/fixtures/fold-regressions)', () => {
  it('ranges over the corner fold the Repeat on screen repeated, from the precreased square', async () => {
    const e = await engine();
    const document = opened();
    const { steps, states } = replayed(e, document);
    const [, diagonals, corner, repeat] = steps;
    expect(repeat?.op.kind).toBe('repeat');
    const range = repeatRange(pathOf(e, document, steps, states), 4, null, null);
    expect(range).toMatchObject({ first: { id: corner!.id }, last: { id: corner!.id }, count: 1, baseline: { id: diagonals!.id } });
  });

  it.each([
    { axis: 'vertical', line: VERTICAL, from: [0, 0], fold: { n: [1, 1], d: 0.5 } },
    { axis: 'horizontal', line: HORIZONTAL, from: [1, 1], fold: { n: [1, 1], d: 1.5 } },
  ] as const)('repeats the corner fold across the $axis center line: the corner it mirrors the first one to lands on the center', async ({ line, from, fold }) => {
    const e = await engine();
    const document = opened();
    const { steps, states } = replayed(e, document);
    const [, diagonals, corner, repeat] = steps;
    // The square's four axes, found on the state before the corner fold.
    const axes = repeatSymmetries(e.scene(states[2]!), e.summary(states[2]!).sheet);
    expect(axes).toHaveLength(4);
    expect(axes.some((axis) => sameRepeatLine(axis.sheet, line))).toBe(true);
    const prepared = prepareRepeat(e, {
      parent: states[4]!,
      axis: line,
      steps: [{ id: corner!.id, op: corner!.op, ...(corner!.choices ? { choices: corner!.choices } : {}), before: states[2]!, after: states[3]! }],
      source: { first: corner!.id, last: corner!.id, revision: foldNodeDigest(document, corner!.id)! },
      baseline: diagonals!.id,
    });
    if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
    expect(prepared.op.parentState).toBe(repeat!.expect);
    expect(prepared.op.steps).toHaveLength(1);
    const entry = prepared.op.steps[0]!;
    const landed = e.step(states[4]!, entry.op, entry.choices);
    if (landed.status !== 'ok') throw new Error(JSON.stringify(landed.refusal));
    expect(landed.fingerprint).toBe(entry.expect);
    // That corner is on the center now, folded along a new valley crease, and the two folded before stay there.
    const center = shown(e, landed.state, CENTER);
    for (const each of [from, [1, 0], [0, 1]] as SheetPoint[]) {
      shown(e, landed.state, each).forEach((value, k) => expect(value, `${each.join(', ')} on the center`).toBeCloseTo(center[k]!, 9));
    }
    const along = (crease: { from: { x: number; y: number }; to: { x: number; y: number } }) =>
      [crease.from, crease.to].every((p) => Math.abs(p.x * fold.n[0] + p.y * fold.n[1] - fold.d) < 1e-9);
    const made = e.scene(landed.state).creases.filter(along);
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((crease) => crease.letter === 'valley')).toBe(true);
    expect(e.scene(states[4]!).creases.filter(along)).toHaveLength(0);
  });

  it('refuses the diagonals: each maps the first corner to a corner already folded', async () => {
    const e = await engine();
    const { steps, states } = replayed(e, opened());
    const corner = steps[2]!;
    const axes = repeatSymmetries(e.scene(states[2]!), e.summary(states[2]!).sheet);
    const diagonals = axes.filter((axis) => !sameRepeatLine(axis.sheet, VERTICAL) && !sameRepeatLine(axis.sheet, HORIZONTAL));
    expect(diagonals).toHaveLength(2);
    for (const axis of diagonals) {
      const prepared = prepareRepeat(e, {
        parent: states[4]!,
        axis: axis.sheet,
        steps: [{ id: corner.id, op: corner.op, ...(corner.choices ? { choices: corner.choices } : {}), before: states[2]!, after: states[3]! }],
        source: { first: corner.id, last: corner.id, revision: 'fh1:corner' },
        baseline: steps[1]!.id,
      });
      expect(prepared).toMatchObject({ status: 'blocked', step: 0, code: 'no_root' });
    }
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { createFoldEngineCalls } from '../../fold/engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../../fold/engine/foldEngineCompoundCalls';
import { prepareRepeat, type RepeatSourceStep } from '../../fold/repeat/repeatPreparation';
import { SQUARE_PAPER, type FoldOp } from '../../fold/document/foldSequenceDocument';
import { sequenceOf } from '../../fold/document/foldSequence.fixtures';
import { initialFoldReaderState, withFoldCursor } from '../../fold/document/foldReaderState';
import { readFoldSequence, writeFoldSequence } from '../../fold/document/foldSequenceFile';
import { createFoldSession, type FoldSession } from '../../fold/session/foldSession';
import { inProcessFoldRuntime, memoryFoldDocument } from '../../fold/session/foldSession.fixtures';
import { captureFoldStep } from './foldStepCapture';
import { foldRepeatCallout, repeatCalloutMark } from './foldRepeatCallout';
import { foldStepPicture, type FoldStepPictureInput } from './foldStepPicture';
import { calloutShape } from '../annotate/annotationModel';
import { storedAnnotations } from '../document/diagramFile';
import { FOLD_PULL_RENDER } from './foldPull';

const t = i18n.t.bind(i18n);
const axis = { n: [1, 0] as const, d: 0.5 };
const sessions: FoldSession[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); });

async function prepared(ops: FoldOp[]) {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm')) });
  const raw = new wasm.FoldEngine();
  const engine = { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
  const sheet = engine.sheet(SQUARE_PAPER);
  if (sheet.status !== 'ok') throw new Error('sheet');
  const steps: RepeatSourceStep[] = [];
  let current = sheet.state;
  for (const [i, op] of ops.entries()) {
    const result = engine.step(current, op);
    if (result.status !== 'ok') throw new Error(JSON.stringify(result));
    steps.push({ id: `source-${i}`, before: current, after: result.state, op });
    current = result.state;
  }
  const recipe = prepareRepeat(engine, { parent: current, steps, axis, source: { first: steps[0]!.id, last: steps.at(-1)!.id, revision: 'test' } });
  if (recipe.status !== 'ready') throw new Error(JSON.stringify(recipe));
  const repeated = engine.step(current, recipe.op);
  if (repeated.status !== 'ok') throw new Error(JSON.stringify(repeated));
  const before = engine.scene(current), after = engine.scene(repeated.state);
  const input: FoldStepPictureInput = {
    shown: before, own: { scene: after, sheet: sheet.summary.sheet, step: repeated.summary.step }, moment: 'before', action: null,
    repeat: foldRepeatCallout(before, after, engine.summary(current).step, axis, t),
  };
  const document = sequenceOf([
    ...steps.map((s, i) => ({ id: s.id, parent: i ? steps[i - 1]!.id : null, op: s.op })),
    { id: 'repeat', parent: steps.at(-1)!.id, op: recipe.op },
  ]);
  engine.clear();
  raw.free();
  return { input, document, wasm };
}

const corner: FoldOp = {
  kind: 'valley', line: { via: 'free', through: [[0, 0.6], [0.4, 1]] },
  moving: [0.05, 0.95], seed: { scope: 'all' },
};
const precrease: FoldOp = {
  kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[0.2, 0], [0.2, 1]] },
  moving: [0.1, 0.5], seed: { scope: 'all' },
};

describe('Repeat diagram callouts', () => {
  it('points to the affected corner, with text following all four rotations and the back pose', async () => {
    const { input } = await prepared([precrease, corner]);
    for (const [rotationDeg, text] of [[0, 'Repeat on the right'], [90, 'Repeat at the bottom'], [180, 'Repeat on the left'], [270, 'Repeat at the top']] as const) {
      const { marks } = foldStepPicture(input, { ...FOLD_PULL_RENDER, rotationDeg });
      expect(marks).toHaveLength(1);
      expect(marks[0]).toMatchObject({ kind: 'callout', imported: 'untouched', text });
      if (rotationDeg === 0) {
        expect(marks[0]!.from[0]).toBeGreaterThan(0.75);
        expect(marks[0]!.from[1]).toBeLessThan(0.25);
        const { box, line } = calloutShape(marks[0]!);
        expect(box.y + box.height).toBeLessThan(0);
        expect(line).not.toBeNull();
      }
    }
    expect(foldStepPicture(input, { ...FOLD_PULL_RENDER, side: 'back' }).marks[0]?.text).toBe('Repeat on the left');
    expect(foldStepPicture({ ...input, moment: 'after' }, FOLD_PULL_RENDER).marks).toEqual([]);
    expect(foldStepPicture(input, { mode: 'crease-pattern', rotationDeg: 0 }).marks).toEqual([]);
  });

  it('locates precrease-only repeats even though no paper moves', async () => {
    const { input } = await prepared([precrease]);
    const { marks } = foldStepPicture(input, FOLD_PULL_RENDER);
    expect(marks[0]).toMatchObject({ text: 'Repeat on the right' });
    expect(marks[0]!.from[0]).toBeCloseTo(0.8);
  });

  it('captures a serialized multi-step repeat on fresh replay, including spread and save/open', async () => {
    const { document, wasm } = await prepared([precrease, corner]);
    const held = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null }))));
    const session = createFoldSession({
      document: memoryFoldDocument({ held, reader: withFoldCursor(initialFoldReaderState(document.id), document, 'repeat') }),
      runtime: inProcessFoldRuntime(() => createFoldEngineCalls(new wasm.FoldEngine()), wasm.fold_engine_version()),
    });
    sessions.push(session);
    const request = { sequence: document.id, step: 'repeat', moment: 'before' as const, render: FOLD_PULL_RENDER };
    const first = await captureFoldStep(session, request, { t });
    expect(first.status).toBe('captured');
    if (first.status !== 'captured') return;
    expect(first.marks).toHaveLength(1);
    expect(first.marks[0]?.text).toBe('Repeat on the right');
    expect(storedAnnotations(JSON.parse(JSON.stringify(first.marks)))).toEqual(first.marks);
    const spread = await captureFoldStep(session, { ...request, render: { ...FOLD_PULL_RENDER, spread: { kind: 'depth', amount: 0.2, toward: 'down' } } }, { t });
    expect(spread.status).toBe('captured');
    if (spread.status === 'captured') expect(spread.marks[0]).toMatchObject({ kind: 'callout', text: 'Repeat on the right', imported: 'untouched' });
  });

  it('uses behind only for a hidden target coincident with its source, and attaches to real target paper', async () => {
    const { input } = await prepared([corner]);
    const repeat = { ...input.repeat!, targets: [{ at: { x: 0.8, y: 0.2 }, source: { x: 0.8, y: 0.2 }, weight: 1, front: false, back: true }] };
    const place = ({ x, y }: { x: number; y: number }): [number, number] => [x, y];
    const frame = { width: 1, height: 1 };
    expect(repeatCalloutMark(repeat, frame, place, 'front', () => 'callout')?.text).toBe('Repeat behind');
    expect(repeatCalloutMark(repeat, frame, place, 'back', () => 'callout')?.text).toBe('Repeat here');
  });
});

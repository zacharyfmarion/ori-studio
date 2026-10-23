import { describe, expect, it } from 'vitest';
import { canonicalJson, foldPathDigest } from './foldDigest';
import { foldHistoryOp, normalizeFoldLandingOp } from './foldLandingMigration';
import { readFoldSequence, writeFoldSequence } from './foldSequenceFile';
import { appendFoldStep } from './foldSequenceEdits';
import { SQUARE_PAPER, type FoldOp } from './foldSequenceDocument';
import { sequenceOf, step, valleyAt } from './foldSequence.fixtures';
import { foldStepInputKey } from '../session/foldSessionEngine';
import { foldSentenceStepOf } from '../sequence/foldSentenceStep';

const legacy: FoldOp = { ...valleyAt(0.4), kind: 'tuck', direction: 'mountain', target: [0.2, 0.2], additionalTargets: [[0.8, 0.2]] };
const migrated = normalizeFoldLandingOp(legacy) as FoldOp;
describe('explicit M/V landing migration', () => {
  it('preserves multi-target recipes, choices, branches, notes, annotations and path identities', () => {
    const raw = { formatVersion: 1, id: 'migration', title: 'Old file', paper: SQUARE_PAPER,
      futureMetadata: { keep: true }, steps: [step('a', null, legacy, { note: 'source step', expect: 'fs1:unchanged', spread: 'off' }), step('branch', null, valleyAt(0.3))] };
    const held = readFoldSequence(raw)!;
    expect(held.document.steps[0]).toEqual({ ...raw.steps[0], op: migrated });
    expect(foldPathDigest(SQUARE_PAPER, raw.steps)).toBe(foldPathDigest(SQUARE_PAPER, held.document.steps));
    const saved = writeFoldSequence(held);
    expect(saved).toMatchObject({ formatVersion: 2, futureMetadata: { keep: true } });
    expect(readFoldSequence(saved)?.document).toEqual(held.document);
    expect(foldStepInputKey({ op: legacy })).toBe(foldStepInputKey({ op: migrated }));
  });
  it('keeps ordinary fold history keys and prevents dropped unknown inputs from being committed', () => {
    const old = valleyAt(0.4);
    expect(foldHistoryOp(normalizeFoldLandingOp(old))).toEqual(old);
    expect(appendFoldStep(sequenceOf([]), { parent: null, op: { ...old, secretGeometry: true } as FoldOp })).toBeNull();
    expect(appendFoldStep(sequenceOf([]), { parent: null, op: { ...legacy, secretGeometry: true } as FoldOp })).toBeNull();
    expect(canonicalJson(foldHistoryOp({ ...old, landing: { kind: 'outer', future: true } }))).toContain('future');
  });
  it('locks damaged landing recipes instead of dropping targets', () => {
    for (const landing of [{ kind: 'against', targets: [] }, { kind: 'against', targets: [[0, NaN]] }, { kind: 'against', targets: [[0.2, 0.2]], future: true }]) {
      const node = { ...step('a', null), op: { ...valleyAt(0.4), landing } };
      const raw = { formatVersion: 2, id: 'bad', paper: SQUARE_PAPER, steps: [node] };
      const held = readFoldSequence(raw)!;
      expect(held.document.steps[0]).toHaveProperty('unknown');
      expect((writeFoldSequence(held).steps as unknown[])[0]).toBe(node);
    }
  });
  it('names a saved insertion as Mountain while retaining the explanatory tuck sentence', () => {
    const sentence = foldSentenceStepOf(migrated, { parent: null, child: null, report: null });
    expect(sentence).toMatchObject({ op: 'fold', direction: 'mountain', inserted: true });
  });
});

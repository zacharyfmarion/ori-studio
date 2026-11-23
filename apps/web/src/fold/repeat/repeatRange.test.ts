import { describe, expect, it } from 'vitest';
import { FOLD_PENDING_NODE, type FoldSessionNode } from '../session/foldSessionState';
import type { FoldPathEntry } from '../sequence/foldSequencePath';
import type { RepeatSymmetry } from './repeatGeometry';
import { repeatAxisIndex, repeatRange, sameRepeatLine } from './repeatRange';

/** A path entry, landed unless `pending`: the sheet for a null id. */
function entry(id: string | null, pending = false): FoldPathEntry {
  const session: FoldSessionNode = pending
    ? FOLD_PENDING_NODE
    : { ...FOLD_PENDING_NODE, status: 'ok', state: { generation: 1, id: id === null ? 0 : Number(id.slice(1)) }, fingerprint: `fs1:${id}`, path: `fh1:${id}` };
  return { id, key: id ?? 'sheet', node: null, kind: id === null ? 'sheet' : 'fold', number: null, status: session.status, session, branches: null };
}

const vertical: RepeatSymmetry = { sheet: { n: [1, 0], d: 0.5 }, side: 'same' };
const horizontal: RepeatSymmetry = { sheet: { n: [0, 1], d: 0.5 }, side: 'behind' };

describe('repeatRange', () => {
  const path = [entry(null), entry('s1'), entry('s2'), entry('s3')];

  it('runs from the step on screen alone, until a first step is chosen', () => {
    expect(repeatRange(path, 3, null, null)).toMatchObject({ first: { id: 's3' }, start: 3, last: { id: 's3' }, end: 3, baseline: { id: 's2' }, count: 1 });
    expect(repeatRange(path, 3, 's1', null)).toMatchObject({ first: { id: 's1' }, start: 1, last: { id: 's3' }, baseline: { id: null }, count: 3 });
    expect(repeatRange(path, 3, 's1', null)?.starts.map((each) => each.id)).toEqual(['s1', 's2', 's3']);
  });

  it('starts at the step on screen when the first step chosen is past it, or off the path', () => {
    expect(repeatRange(path, 2, 's3', null)).toMatchObject({ first: { id: 's2' }, count: 1 });
    expect(repeatRange(path, 2, 'elsewhere', null)).toMatchObject({ first: { id: 's2' }, count: 1 });
  });

  it('ends at the last step chosen, before the step on screen, which the repeat is added after', () => {
    const range = repeatRange(path, 3, 's1', 's2');
    expect(range).toMatchObject({ first: { id: 's1' }, last: { id: 's2' }, end: 2, baseline: { id: null }, count: 2 });
    // A range of one, the step on screen two steps on.
    expect(repeatRange(path, 3, 's1', 's1')).toMatchObject({ first: { id: 's1' }, last: { id: 's1' }, count: 1 });
    // It may end at its first step or any after it, through the step on screen.
    expect(range?.ends.map((each) => each.id)).toEqual(['s1', 's2', 's3']);
    expect(repeatRange(path, 3, 's2', null)?.ends.map((each) => each.id)).toEqual(['s2', 's3']);
  });

  it('ends at the step on screen when the last step chosen is before the first, past the step on screen, or off the path', () => {
    expect(repeatRange(path, 3, 's2', 's1')).toMatchObject({ first: { id: 's2' }, last: { id: 's3' }, count: 2 });
    expect(repeatRange(path, 2, 's1', 's3')).toMatchObject({ first: { id: 's1' }, last: { id: 's2' }, count: 2 });
    expect(repeatRange(path, 3, 's1', 'elsewhere')).toMatchObject({ last: { id: 's3' }, count: 3 });
  });

  it('offers only the starts a repeat can be prepared from, and none at the flat sheet or before the step lands', () => {
    const waiting = [entry(null), entry('s1', true), entry('s2'), entry('s3')];
    // Neither s1 (not landed) nor s2 (its parent has not) can start the range.
    expect(repeatRange(waiting, 3, 's1', null)?.starts.map((each) => each.id)).toEqual(['s3']);
    expect(repeatRange(waiting, 3, 's1', null)?.first.id).toBe('s3');
    expect(repeatRange(path, 0, null, null)).toBeNull();
    expect(repeatRange([entry(null), entry('s1', true)], 1, null, null)).toBeNull();
    // The step on screen still folding: there is nothing yet to add the repeat after.
    expect(repeatRange([entry(null), entry('s1'), entry('s2', true)], 2, 's1', 's1')).toBeNull();
  });

  it('offers no end past a step still folding', () => {
    const folding = [entry(null), entry('s1'), entry('s2', true), entry('s3')];
    expect(repeatRange(folding, 3, 's1', 's1')?.ends.map((each) => each.id)).toEqual(['s1']);
    // Through the step on screen, the range waits for the step between to land.
    expect(repeatRange(folding, 3, 's1', null)).toBeNull();
  });
});

describe('the axis Repeat takes', () => {
  it('is the one last chosen while the range has it, else the first, else none', () => {
    expect(repeatAxisIndex([vertical, horizontal], horizontal.sheet)).toBe(1);
    // Written the other way round, it is the same line.
    expect(repeatAxisIndex([vertical, horizontal], { n: [0, -1], d: -0.5 })).toBe(1);
    expect(repeatAxisIndex([vertical], horizontal.sheet)).toBe(0);
    expect(repeatAxisIndex([vertical, horizontal], null)).toBe(0);
    expect(repeatAxisIndex([], vertical.sheet)).toBe(-1);
  });

  it('compares lines within Repeat’s tolerance, whichever way each is written', () => {
    expect(sameRepeatLine({ n: [1, 0], d: 0.5 }, { n: [-1, 0], d: -0.5 })).toBe(true);
    expect(sameRepeatLine({ n: [1, 0], d: 0.5 }, { n: [1, 0], d: 0.5 + 1e-4 })).toBe(false);
  });
});

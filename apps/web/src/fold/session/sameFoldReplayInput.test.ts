import { expect, it } from 'vitest';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import { sameFoldReplayInput } from './sameFoldReplayInput';
import type { FoldStep } from '../document/foldSequenceDocument';

it('skips only edits outside replay inputs, including choices and drift expectations', () => {
  const node = step('a', null, valleyAt(.5));
  const doc = sequenceOf([node]);
  const withNode = (patch: Partial<FoldStep>) => ({ ...doc, steps: [{ ...node, ...patch }] });
  expect(sameFoldReplayInput(doc, withNode({ note: 'note', marks: [] }))).toBe(true);
  for (const patch of [{ id: 'b' }, { parent: 'b' }, { op: valleyAt(.2) }, { choices: {} }, { expect: 'new' }]) {
    expect(sameFoldReplayInput(doc, withNode(patch))).toBe(false);
  }
  expect(sameFoldReplayInput(doc, { ...doc, paper: { ...doc.paper } })).toBe(false);
  expect(sameFoldReplayInput(doc, { ...doc, steps: [] })).toBe(false);
  const locked = { id:'a',parent:null,unknown:{op:{kind:'future'}} };
  const future = { ...doc,steps:[locked] };
  expect(sameFoldReplayInput(future, {...future,steps:[{...locked,note:'note'}]})).toBe(true);
  expect(sameFoldReplayInput(future, {...future,steps:[{...locked,unknown:{}}]})).toBe(false);
});

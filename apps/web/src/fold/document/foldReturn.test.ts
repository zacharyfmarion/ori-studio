import { describe, expect, it } from 'vitest';
import { foldReturnHistory, resolveFoldReturn } from './foldReturn';
import { sequenceOf, step } from './foldSequence.fixtures';
import { appendFoldStep } from './foldSequenceEdits';
import type { FoldReturnOp } from './foldSequenceDocument';

const document = sequenceOf([step('a', null), step('b', 'a'), step('sibling', 'a'), step('c', 'b')]);
const state = (id: number) => ({ state: id, status: 'ok' as const, path: `fh1:${id}`, fingerprint: `fs1:${id}` as const });
const nodes = new Map([['a', state(1)], ['b', state(2)], ['sibling', state(3)], ['c', state(4)]]);
const op: FoldReturnOp = { kind: 'unfold-to', target: 'a', source: { path: 'fh1:2', state: 'fs1:2', targetState: 'fs1:1' } };
describe('return dependencies', () => {
  it('resolves the source ancestor path from the target, including the sheet with a zero engine handle', () => {
    expect(resolveFoldReturn(document, 'b', op, state(0), nodes)).toEqual({ target: 1, history: [1, 2] });
    expect(resolveFoldReturn(document, 'b', { ...op, target: null, source: { ...op.source, targetState: 'fs1:0' } }, state(0), nodes))
      .toEqual({ target: 0, history: [0, 1, 2] });
  });
  it.each(['b', 'c', 'sibling', 'foreign'])('rejects non-ancestor %s at replay and append', (target) => {
    expect(resolveFoldReturn(document, 'b', { ...op, target }, state(0), nodes)).toEqual({ code: 'return_target_invalid' });
    expect(appendFoldStep(document, { parent: 'b', op: { ...op, target } })).toBeNull();
  });
  it('never reaches before the last Import CP on the path', () => {
    const jump = { kind: 'cp-jump', cpJson: '{}', orderJson: '[]', origin: 'cp' } as const;
    const imported = sequenceOf([step('a', null), step('b', 'a', jump), step('c', 'b'), step('d', 'c', jump), step('e', 'd')]);
    const states = new Map(['a', 'b', 'c', 'd', 'e'].map((id, i) => [id, state(i + 1)]));
    const back = (target: string | null) => resolveFoldReturn(imported, 'e', {
      ...op, target, source: { path: 'fh1:5', state: 'fs1:5', targetState: `fs1:${target ? states.get(target)!.state : 0}` },
    }, state(0), states);
    // Past an import, the history starts at the last one: d.
    expect(back(null)).toEqual({ target: 0, history: [4, 5] });
    expect(back('a')).toEqual({ target: 1, history: [4, 5] });
    expect(back('c')).toEqual({ target: 3, history: [4, 5] });
    // To the import, or after it, at the target.
    expect(back('d')).toEqual({ target: 4, history: [4, 5] });
    expect(foldReturnHistory([0, 1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(foldReturnHistory([0, 1, 2, 3], 0, (i) => i === 1 || i === 2)).toEqual([2, 3]);
    expect(foldReturnHistory([0, 1, 2, 3], 3, (i) => i === 1)).toEqual([3]);
  });
  it('refuses changed paths, changed target state, and unavailable history', () => {
    for (const source of [{ ...op.source, path: 'fh1:changed' }, { ...op.source, targetState: 'fs1:changed' }]) {
      expect(resolveFoldReturn(document, 'b', { ...op, source }, state(0), nodes)).toEqual({ code: 'return_source_changed' });
    }
    // A state the return draws its creases from: b, between the target and the source.
    const gap = new Map([...nodes].map(([id, node]) => [id, id === 'b' ? { ...node, state: null as number | null } : node] as const));
    const fromC = { ...op, source: { path: 'fh1:4', state: 'fs1:4', targetState: 'fs1:1' } };
    expect(resolveFoldReturn(document, 'c', fromC, state(0), nodes)).toEqual({ target: 1, history: [1, 2, 4] });
    expect(resolveFoldReturn(document, 'c', fromC, state(0), gap)).toEqual({ code: 'return_state_unavailable' });
  });
});

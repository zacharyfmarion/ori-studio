import { describe, expect, it } from 'vitest';

import type { FoldLockedStep, FoldMark } from './foldSequenceDocument';
import {
  activePath,
  childrenOf,
  foldStepTree,
  lockedIds,
  pathTo,
  replayOrder,
  subtreeIds,
  visibleMarks,
} from './foldStepTree';
import { sequenceOf, step, valleyAt } from './foldSequence.fixtures';

const steps = [
  step('a', null),
  step('b', 'a', valleyAt(0.25)),
  step('c', 'a', valleyAt(0.75)),
  step('d', 'b', valleyAt(0.1)),
  step('e', null, valleyAt(0.3)),
  step('f', 'c', valleyAt(0.9)),
];

const ids = (nodes: readonly { id: string }[]) => nodes.map((node) => node.id);

describe('foldStepTree', () => {
  it('lists children in the order they were made, the sheet’s under its own key', () => {
    const tree = foldStepTree(steps);
    expect(ids(childrenOf(tree, null))).toEqual(['a', 'e']);
    expect(ids(childrenOf(tree, 'a'))).toEqual(['b', 'c']);
    expect(childrenOf(tree, 'd')).toEqual([]);
    expect(foldStepTree(steps)).toBe(tree);
  });

  it('finds the path to a step, and the steps that fold from it', () => {
    const tree = foldStepTree(steps);
    expect(ids(pathTo(tree, 'd')!)).toEqual(['a', 'b', 'd']);
    expect(pathTo(tree, 'missing')).toBeNull();
    expect([...subtreeIds(tree, 'a')].sort()).toEqual(['a', 'b', 'c', 'd', 'f']);
    expect(subtreeIds(tree, 'missing').size).toBe(0);
  });

  it('replays the active path first, then the rest breadth-first, each step after its parent', () => {
    const tree = foldStepTree(steps);
    const first = activePath(tree, { '': 'a', a: 'b' });
    expect(ids(first)).toEqual(['a', 'b', 'd']);
    expect(ids(replayOrder(tree, first))).toEqual(['a', 'b', 'd', 'e', 'c', 'f']);
  });

  it('locks a step it cannot read and everything that folds from it', () => {
    const locked: FoldLockedStep = { id: 'b', parent: 'a', unknown: { id: 'b', parent: 'a', op: { kind: 'sink' } } };
    const tree = foldStepTree(steps.map((node) => (node.id === 'b' ? locked : node)));
    expect([...lockedIds(tree)].sort()).toEqual(['b', 'd']);
  });
});

describe('visibleMarks', () => {
  const mark = (id: string): FoldMark => ({ id, from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 2 } });

  it('shows a step the sheet’s marks and those made on its path, never a sibling’s', () => {
    const marked = steps.map((node) =>
      ['a', 'b', 'c'].includes(node.id) ? { ...node, marks: [mark(`m-${node.id}`)] } : node
    );
    const document = {
      ...sequenceOf(marked),
      sheetMarks: [mark('m-sheet'), { id: 'm-newer', unknown: { id: 'm-newer' } }],
    };
    expect(ids(visibleMarks(document, null))).toEqual(['m-sheet']);
    expect(ids(visibleMarks(document, 'd'))).toEqual(['m-sheet', 'm-a', 'm-b']);
    expect(ids(visibleMarks(document, 'c'))).toEqual(['m-sheet', 'm-a', 'm-c']);
  });
});

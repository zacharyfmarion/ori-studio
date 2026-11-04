import { beforeEach, describe, expect, it } from 'vitest';
import { nextFoldedFigureId, noteFoldedFigureIds, resetFoldedFigureIds } from './foldedFigureIds';

describe('folded figure ids', () => {
  beforeEach(() => resetFoldedFigureIds());

  it('hands out each id once a session, a deleted figure’s included', () => {
    const first = nextFoldedFigureId();
    expect(first).toBe('generated-1');
    // `generated-1` deleted: no figure has it, and the next fold still gets a new one.
    expect(nextFoldedFigureId([])).toBe('generated-2');
  });

  it('starts past every id a file names, its figures’ and its layer order bag’s', () => {
    noteFoldedFigureIds(['generated-1', 'generated-7', 'generated-4']);
    expect(nextFoldedFigureId([{ id: 'generated-1' }])).toBe('generated-8');
  });

  it('passes the live figures too, for a path that put them in the store unnoted', () => {
    expect(nextFoldedFigureId([{ id: 'generated-3' }])).toBe('generated-4');
  });

  it('ignores ids of another scheme', () => {
    noteFoldedFigureIds(['tree-1', 'generated-', 'generated-2x', 'generated-0', 'generated--3']);
    expect(nextFoldedFigureId()).toBe('generated-1');
  });
});

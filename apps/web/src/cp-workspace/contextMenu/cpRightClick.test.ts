import { describe, expect, it } from 'vitest';
import { cpHasSelection, cpRightClickOutcome, type CpRightClickState } from './cpRightClick';

function state(overrides: Partial<CpRightClickState> = {}): CpRightClickState {
  return { moved: false, cancelled: false, figureId: null, hasSelection: false, ...overrides };
}

describe('cpRightClickOutcome', () => {
  it('erases when nothing is selected — the upstream gesture, unchanged', () => {
    expect(cpRightClickOutcome(state())).toBe('erase');
  });

  it('raises the selection menu when the pattern has a selection', () => {
    expect(cpRightClickOutcome(state({ hasSelection: true }))).toBe('selection-menu');
  });

  it('erases on a drag even with a live selection', () => {
    // The box is the whole point of right-drag. A menu that could interrupt it
    // would make erasing a region impossible the moment anything was selected.
    expect(cpRightClickOutcome(state({ moved: true, hasSelection: true }))).toBe('erase');
  });

  it('erases on a drag across a folded figure', () => {
    expect(cpRightClickOutcome(state({ moved: true, figureId: 'figure-1' }))).toBe('erase');
  });

  it('prefers a folded figure over the selection menu', () => {
    expect(
      cpRightClickOutcome(state({ figureId: 'figure-1', hasSelection: true }))
    ).toBe('folded-figure-menu');
  });

  it('raises a folded figure menu with nothing selected', () => {
    expect(cpRightClickOutcome(state({ figureId: 'figure-1' }))).toBe('folded-figure-menu');
  });

  it('cancels ahead of every other outcome', () => {
    expect(
      cpRightClickOutcome(
        state({ cancelled: true, moved: true, figureId: 'figure-1', hasSelection: true })
      )
    ).toBe('cancel');
  });
});

describe('cpHasSelection', () => {
  it('is false for an empty selection', () => {
    expect(cpHasSelection({ lines: [], points: [], circles: [] })).toBe(false);
  });

  it.each([
    ['lines', { lines: [3], points: [], circles: [] }],
    ['points', { lines: [], points: [7], circles: [] }],
    // Circles are an Ori Studio addition with no Oriedita selection at all, so
    // they are easy to leave out of a predicate like this one.
    ['circles', { lines: [], points: [], circles: [2] }],
  ])('is true for a selection of %s alone', (_kind, selection) => {
    expect(cpHasSelection(selection)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { cpHasSelection, cpRightClickOutcome, type CpRightClickState } from './cpRightClick';

function state(overrides: Partial<CpRightClickState> = {}): CpRightClickState {
  return {
    moved: false,
    cancelled: false,
    figureId: null,
    hasSelection: false,
    erasableUnderCursor: false,
    ...overrides,
  };
}

describe('cpRightClickOutcome', () => {
  it('erases over an erasable primitive with nothing selected — upstream, unchanged', () => {
    expect(cpRightClickOutcome(state({ erasableUnderCursor: true }))).toBe('erase');
  });

  it('raises the blank menu on empty paper, where erasing would do nothing', () => {
    // The whole justification for taking this press: upstream's right-click is
    // `deleteSingleLineOrCircle`, so with nothing erasable under the cursor it
    // consumes the click and shows nothing.
    expect(cpRightClickOutcome(state())).toBe('blank-menu');
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

  it('erases on a drag across blank paper', () => {
    // Right-drag is the erase *box*, which starts on blank paper by definition —
    // so the blank menu must never take a drag.
    expect(cpRightClickOutcome(state({ moved: true }))).toBe('erase');
  });

  it('prefers the selection menu over the blank menu', () => {
    expect(cpRightClickOutcome(state({ hasSelection: true }))).toBe('selection-menu');
  });

  it('prefers a folded figure over the blank menu', () => {
    expect(cpRightClickOutcome(state({ figureId: 'figure-1' }))).toBe('folded-figure-menu');
  });

  it('never takes a press that erase would act on', () => {
    // The parity guarantee, stated as a property over the whole input space:
    // whenever erasing would do something, the outcome is `erase` — no menu can
    // swallow a press upstream would have deleted with.
    for (const moved of [false, true]) {
      for (const hasSelection of [false, true]) {
        for (const figureId of [null, 'figure-1']) {
          const outcome = cpRightClickOutcome(
            state({ moved, hasSelection, figureId, erasableUnderCursor: true })
          );
          // A selection or a figure legitimately outranks erase on a *click* —
          // those were already true before the blank menu existed. What must
          // never happen is the blank menu taking one.
          expect(outcome).not.toBe('blank-menu');
        }
      }
    }
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

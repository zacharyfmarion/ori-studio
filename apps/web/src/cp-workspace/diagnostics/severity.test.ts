import { describe, expect, it } from 'vitest';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import {
  countCpDiagnosticErrors,
  countCpDiagnostics,
  cpDiagnosticClass,
  sortedCpDiagnosticEntries,
} from './severity';

function entry(over: Partial<OristudioCpDiagnosticEntry> = {}): OristudioCpDiagnosticEntry {
  return {
    id: 'd1',
    kind: 'CheckCamv',
    severity: 'error',
    message: '',
    ...over,
  };
}

describe('what kind of thing an entry is', () => {
  it('reads errors and warnings from the severity', () => {
    expect(cpDiagnosticClass(entry())).toBe('error');
    expect(cpDiagnosticClass(entry({ severity: 'warning', rule: 'InteriorBorder' }))).toBe(
      'warning'
    );
  });

  it('splits the informational entries by whether there is anything to do', () => {
    // The line the whole of never-report-silence.md turns on. Undecided carries
    // an angle to apply; unexamined carries a reason nothing can be said. Given
    // one count over both, a user would learn nothing from either.
    expect(cpDiagnosticClass(entry({ severity: 'info', rule: 'Undecided' }))).toBe('undecided');
    expect(cpDiagnosticClass(entry({ severity: 'info', rule: 'UndecidedChoice' }))).toBe(
      'undecided'
    );
    for (const rule of ['UnsplitJunction', 'NotEnoughCreases', 'TooManyUnknowns', 'NoUniqueAnswer']) {
      expect(cpDiagnosticClass(entry({ severity: 'info', rule })), rule).toBe('unexamined');
    }
  });

  it('treats a code it has never met as unexamined rather than as a fault', () => {
    // `unexamined` is the safe default in both directions: an unknown entry has
    // not been shown to be a problem, and guessing `error` would raise the
    // pre-fold warning modal on it.
    expect(cpDiagnosticClass(entry({ severity: 'info', rule: 'SomeRuleAddedLater' }))).toBe(
      'unexamined'
    );
    expect(cpDiagnosticClass(entry({ severity: 'debug' }))).toBe('unexamined');
  });

  it('keeps the undecided ones out of the count that gates the fold warning', () => {
    // A pattern a quarter of the way through design is around 60% undecided.
    // Counting those as violations would raise Oriedita's "continue to fold?"
    // modal over every document mid-edit.
    const entries = [
      entry(),
      entry({ severity: 'warning' }),
      entry({ severity: 'info', rule: 'Undecided' }),
      entry({ severity: 'info', rule: 'TooManyUnknowns' }),
    ];
    expect(countCpDiagnosticErrors(entries)).toBe(1);
    expect(countCpDiagnostics(entries)).toEqual({
      error: 1,
      warning: 1,
      undecided: 1,
      unexamined: 1,
    });
  });
});

describe('the order the list shows entries in', () => {
  it('puts the findings above the observations', () => {
    // Kernel order is vertex order, which was fine while every entry was an
    // error. It stopped being fine the moment a healthy mid-design pattern could
    // contribute hundreds of informational rows for three errors to hide among.
    const sorted = sortedCpDiagnosticEntries([
      entry({ id: 'u1', severity: 'info', rule: 'Undecided' }),
      entry({ id: 'x1', severity: 'info', rule: 'TooManyUnknowns' }),
      entry({ id: 'e1' }),
      entry({ id: 'w1', severity: 'warning' }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['e1', 'w1', 'x1', 'u1']);
  });

  it('is stable within a class, so a row keeps its identity across a recompute', () => {
    const entries = [entry({ id: 'e1' }), entry({ id: 'e2' }), entry({ id: 'e3' })];
    expect(sortedCpDiagnosticEntries(entries).map((item) => item.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('returns the same array when nothing needs moving', () => {
    // The common case by far is a handful of errors or none at all, and this
    // runs on every render of a list that sits above a canvas.
    const entries = [entry({ id: 'e1' }), entry({ id: 'w1', severity: 'warning' })];
    expect(sortedCpDiagnosticEntries(entries)).toBe(entries);
    expect(sortedCpDiagnosticEntries([])).toEqual([]);
  });
});

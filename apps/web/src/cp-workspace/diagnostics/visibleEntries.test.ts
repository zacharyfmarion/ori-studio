import { describe, expect, it } from 'vitest';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import {
  cpDiagnosticEntryAt,
  visibleCpDiagnosticEntries,
  visibleCpDiagnosticEntry,
} from './visibleEntries';

function entry(id: string): OristudioCpDiagnosticEntry {
  return { id, kind: 'CheckCamv', severity: 'error', message: id };
}

function result(
  operation: string,
  ids: string[]
): OristudioCpCommandResult {
  return {
    operation,
    status: 'OracleTested',
    diagnostics: [],
    diagnostic_entries: ids.map(entry),
  } as OristudioCpCommandResult;
}

const camv = result('CheckCamv', ['camv-1', 'camv-2']);

describe('visibleCpDiagnosticEntries', () => {
  it('shows the CAMV overlay when the toggle is on', () => {
    expect(visibleCpDiagnosticEntries(camv, null, true).map((e) => e.id)).toEqual([
      'camv-1',
      'camv-2',
    ]);
  });

  it('hides the CAMV overlay when the toggle is off', () => {
    expect(visibleCpDiagnosticEntries(camv, null, false)).toEqual([]);
  });

  it('keeps a non-CAMV check visible while the overlay is off', () => {
    // Check1 is a command the user ran on purpose; the toggle governs the
    // always-on overlay, not an explicit check's findings.
    const check1 = result('Check1', ['check1-1']);
    expect(visibleCpDiagnosticEntries(camv, check1, false).map((e) => e.id)).toEqual(['check1-1']);
  });

  it('hides a CheckCamv command result with the overlay', () => {
    expect(visibleCpDiagnosticEntries(camv, result('CheckCamv', ['x']), false)).toEqual([]);
  });

  it('does not double a CheckCamv result against the overlay it recomputed', () => {
    const rerun = result('CheckCamv', ['camv-1', 'camv-2']);
    expect(visibleCpDiagnosticEntries(camv, rerun, true).map((e) => e.id)).toEqual([
      'camv-1',
      'camv-2',
    ]);
  });

  it('merges the overlay with another check that is also showing', () => {
    const check1 = result('Check1', ['check1-1']);
    expect(visibleCpDiagnosticEntries(camv, check1, true).map((e) => e.id)).toEqual([
      'camv-1',
      'camv-2',
      'check1-1',
    ]);
  });

  it('lifts the errors above the informational rows, in every combination', () => {
    // The ordering has to be applied here rather than in the HUD, or the list,
    // the canvas markers and the jump-to-diagnostic would each hold a different
    // idea of which entry is which.
    const mixed = {
      ...result('CheckCamv', []),
      diagnostic_entries: [
        { ...entry('undecided-1'), severity: 'info', rule: 'Undecided' },
        entry('error-1'),
      ],
    } as OristudioCpCommandResult;
    expect(visibleCpDiagnosticEntries(mixed, null, true).map((e) => e.id)).toEqual([
      'error-1',
      'undecided-1',
    ]);
    const check1 = result('Check1', ['check1-1']);
    expect(visibleCpDiagnosticEntries(mixed, check1, true).map((e) => e.id)).toEqual([
      'error-1',
      'check1-1',
      'undecided-1',
    ]);
  });

  it('ignores a command that reports no diagnostics', () => {
    const fix = result('Fix1', []);
    expect(visibleCpDiagnosticEntries(camv, fix, true).map((e) => e.id)).toEqual([
      'camv-1',
      'camv-2',
    ]);
  });
});

describe('visibleCpDiagnosticEntry', () => {
  const entries = visibleCpDiagnosticEntries(camv, null, true);

  it('finds a listed entry', () => {
    expect(visibleCpDiagnosticEntry(entries, 'camv-2')?.id).toBe('camv-2');
  });

  it('returns null for a hidden or unknown id', () => {
    expect(visibleCpDiagnosticEntry(entries, 'check1-1')).toBeNull();
    expect(visibleCpDiagnosticEntry(entries, null)).toBeNull();
    expect(visibleCpDiagnosticEntry(visibleCpDiagnosticEntries(camv, null, false), 'camv-1')).toBeNull();
  });
});

describe('cpDiagnosticEntryAt', () => {
  function at(id: string, x: number, y: number): OristudioCpDiagnosticEntry {
    return { ...entry(id), point: { x, y } };
  }

  const entries = [at('closure', 0, -100), at('undecided', 40, 60)];

  it('finds the entry reporting on a vertex the kernel named', () => {
    // The coordinates of `solve/failure_case.osf`'s failing vertex, as the fold
    // refusal and the CAMV entry both carry it. Measured on that file, the two
    // are bit-identical — the vertex is a segment endpoint on both paths — so a
    // sane tolerance is about surviving paths where it is not.
    expect(cpDiagnosticEntryAt(entries, { x: 2.0463630789890885e-12, y: -100 })?.id).toBe(
      'closure'
    );
  });

  it('accepts anything the kernel would have merged into one vertex', () => {
    // 1e-6 is `checks_spatial::CELL`. A point inside it is not "near" the
    // vertex, it *is* the vertex as far as every check that ships is concerned.
    expect(cpDiagnosticEntryAt(entries, { x: 9e-7, y: -100 })?.id).toBe('closure');
    expect(cpDiagnosticEntryAt(entries, { x: 2e-6, y: -100 })).toBeNull();
  });

  it('measures a distance, not a per-axis box', () => {
    // 9e-7 on each axis is inside a box of half-width 1e-6 and 1.27e-6 away — so
    // a box would admit a pair the kernel's own `point.distance(..) < CELL`
    // rejects, and the corner slack would be this module's invention rather than
    // the epsilon it cites.
    expect(Math.hypot(9e-7, 9e-7)).toBeGreaterThan(1e-6);
    expect(cpDiagnosticEntryAt(entries, { x: 9e-7, y: -100 + 9e-7 })).toBeNull();
    // Inside the circle on the same diagonal still matches.
    expect(cpDiagnosticEntryAt(entries, { x: 7e-7, y: -100 + 7e-7 })?.id).toBe('closure');
  });

  it('answers null rather than guessing', () => {
    expect(cpDiagnosticEntryAt(entries, { x: 300, y: 300 })).toBeNull();
    expect(cpDiagnosticEntryAt(entries, null)).toBeNull();
    expect(cpDiagnosticEntryAt(entries, undefined)).toBeNull();
    // An entry with no point of its own is not a match for every point.
    expect(cpDiagnosticEntryAt([entry('pointless')], { x: 0, y: 0 })).toBeNull();
  });

  it('takes the first match, so severity order decides a tie', () => {
    // `visibleCpDiagnosticEntries` sorts worst-first; two rows about one vertex
    // must resolve to the one the HUD lists first, not to whichever is a
    // floating-point hair nearer.
    const sameVertex = [at('error-row', 0, 0), at('info-row', 1e-9, 0)];
    expect(cpDiagnosticEntryAt(sameVertex, { x: 1e-9, y: 0 })?.id).toBe('error-row');
  });
});

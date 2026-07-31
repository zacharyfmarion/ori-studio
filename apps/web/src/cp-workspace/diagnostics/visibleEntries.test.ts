import { describe, expect, it } from 'vitest';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { visibleCpDiagnosticEntries, visibleCpDiagnosticEntry } from './visibleEntries';

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

import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { diagnosticHudStatus, isDiagnosticResultOperation } from './hudStatus';

const t = ((_key: string, fallback: string, vars?: Record<string, string | number>) =>
  fallback.replace(
    /\{\{(\w+)\}\}/gu,
    (_, name: string) => String(vars?.[name] ?? '')
  )) as unknown as TFunction;

function violation(index: number, rule = 'Maekawa', color = 'NotEnoughMountain') {
  return {
    id: `CheckCamv-${index}`,
    kind: 'CheckCamv',
    severity: 'error',
    message: `Flat-foldability violation: ${rule}`,
    rule,
    violation_color: color,
  } satisfies OristudioCpDiagnosticEntry;
}

function camv(entries: OristudioCpDiagnosticEntry[]): OristudioCpCommandResult {
  return {
    operation: 'CheckCamv' as OristudioCpCommandResult['operation'],
    status: 'OracleTested' as OristudioCpCommandResult['status'],
    diagnostics: [`Check CAMV found ${entries.length} issue(s)`],
    diagnostic_entries: entries,
  };
}

describe('the collapsed HUD subtitle', () => {
  it('names the issue when there is exactly one', () => {
    const status = diagnosticHudStatus(t, camv([violation(1)]));
    expect(status?.label).toBe('1 Foldability Error');
    expect(status?.detail).toBe('Not enough mountain folds');
  });

  it('says nothing when there are several', () => {
    // Naming one of five reads as "this is the problem" rather than as a
    // sample. The count in the label carries it; expanding shows the rest.
    for (const count of [2, 3, 5]) {
      const entries = Array.from({ length: count }, (_, i) => violation(i + 1));
      const status = diagnosticHudStatus(t, camv(entries));
      expect(status?.label).toBe(`${count} Foldability Errors`);
      expect(status?.detail, `${count} entries`).toBeNull();
    }
  });

  it('never surfaces the kernel summary when structured entries exist', () => {
    // "Check CAMV found 2 issue(s)" — raw English that bypasses i18n, and a
    // survivor of the CAMV rename. It must not reach the UI through this path.
    for (const count of [1, 2, 4]) {
      const entries = Array.from({ length: count }, (_, i) => violation(i + 1));
      expect(diagnosticHudStatus(t, camv(entries))?.detail ?? '').not.toMatch(/CAMV/u);
    }
  });

  it('falls back to the kernel string only when there are no entries at all', () => {
    // Some checks report a summary and no per-item entries. Suppressing the
    // subtitle there would leave the HUD with nothing but a count of zero.
    const result: OristudioCpCommandResult = {
      ...camv([]),
      diagnostics: ['Boundary is not flat-foldable'],
    };
    expect(diagnosticHudStatus(t, result)?.detail).toBe('Boundary is not flat-foldable');
  });
});

describe('tone and count', () => {
  it('reports errors over warnings', () => {
    const entries = [violation(1), { ...violation(2), severity: 'warning' }];
    const status = diagnosticHudStatus(t, camv(entries));
    expect(status?.tone).toBe('error');
    expect(status?.label).toBe('1 Foldability Error');
  });

  it('reports a warning-only result as a warning', () => {
    const entries = [{ ...violation(1), severity: 'warning' }];
    const status = diagnosticHudStatus(t, camv(entries));
    expect(status?.tone).toBe('warn');
    expect(status?.label).toBe('1 Foldability Warning');
    expect(status?.detail).toBe('Not enough mountain folds');
  });

  it('reports a clean result as OK, unless the caller only wants issues', () => {
    const clean: OristudioCpCommandResult = { ...camv([]), diagnostics: ['no issues'] };
    expect(diagnosticHudStatus(t, clean)?.tone).toBe('ok');
    expect(diagnosticHudStatus(t, clean, { issueOnly: true })).toBeNull();
  });
});

describe('which results the HUD summarises', () => {
  it('takes the diagnostic commands and nothing else', () => {
    for (const op of ['Check1', 'Check2', 'Check3', 'Check4', 'CheckCamv', 'FlatFoldableCheck']) {
      expect(isDiagnosticResultOperation(op), op).toBe(true);
    }
    for (const op of ['CreaseSetFoldAngle', 'Fold', 'ExportCp', '']) {
      expect(isDiagnosticResultOperation(op), op).toBe(false);
    }
  });

  it('returns null for a non-diagnostic result or no result', () => {
    expect(diagnosticHudStatus(t, null)).toBeNull();
    expect(diagnosticHudStatus(t, undefined)).toBeNull();
    expect(
      diagnosticHudStatus(t, {
        ...camv([violation(1)]),
        operation: 'CreaseSetFoldAngle' as OristudioCpCommandResult['operation'],
      })
    ).toBeNull();
  });

  it('returns null when the kernel reported nothing at all', () => {
    expect(diagnosticHudStatus(t, { ...camv([]), diagnostics: [] })).toBeNull();
  });
});

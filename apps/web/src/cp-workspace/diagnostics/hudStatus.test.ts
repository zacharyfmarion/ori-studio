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

function undecided(index: number, rule = 'Undecided') {
  return {
    id: `SpatialUndecided-${index}`,
    kind: 'SpatialUndecided',
    severity: 'info',
    message: 'Undecided',
    rule,
    fold_angle_degrees: rule === 'Undecided' ? -90 : undefined,
  } satisfies OristudioCpDiagnosticEntry;
}

function unexamined(index: number, rule = 'TooManyUnknowns') {
  return {
    id: `SpatialUnknowable-${index}`,
    kind: 'SpatialUnknowable',
    severity: 'info',
    message: 'Not checked',
    rule,
  } satisfies OristudioCpDiagnosticEntry;
}

function camv(entries: OristudioCpDiagnosticEntry[]): OristudioCpCommandResult {
  return {
    operation: 'CheckCamv' as OristudioCpCommandResult['operation'],
    status: 'OracleTested' as OristudioCpCommandResult['status'],
    diagnostics: [`Check CAMV found ${entries.length} issue(s)`],
    diagnostic_entries: entries,
    // Whatever the entries say, something was examined. Overridden where the
    // point of the case is that nothing was.
    checked_vertices: 12,
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
    for (const count of [0, 1, 2, 4]) {
      const entries = Array.from({ length: count }, (_, i) => violation(i + 1));
      expect(diagnosticHudStatus(t, camv(entries))?.detail ?? '').not.toMatch(/CAMV/u);
    }
  });

  it('says nothing extra on a clean result', () => {
    // The no-entries case *is* the clean case, and the kernel's summary there is
    // "Check CAMV found 0 issue(s)" — a restatement of the headline, in raw
    // English, under a name the UI stopped using. It reached the screen until a
    // fixture with no violations was opened.
    const clean: OristudioCpCommandResult = {
      ...camv([]),
      diagnostics: ['Check CAMV found 0 issue(s)'],
    };
    const status = diagnosticHudStatus(t, clean);
    expect(status?.label).toBe('Foldability OK');
    expect(status?.detail).toBeNull();
  });
});

describe('tone and count', () => {
  it('names both when errors and warnings are mixed, and keeps the error tone', () => {
    // The label used to report errors alone, which read as the whole account of
    // a list that also held warnings — the row count did not match the headline.
    const entries = [violation(1), { ...violation(2), severity: 'warning' }];
    const status = diagnosticHudStatus(t, camv(entries));
    expect(status?.tone).toBe('error');
    expect(status?.label).toBe('1 Foldability Error, 1 Warning');
  });

  it('pluralises each clause on its own count', () => {
    const entries = [
      violation(1),
      violation(2),
      { ...violation(3), severity: 'warning' },
    ];
    expect(diagnosticHudStatus(t, camv(entries))?.label).toBe('2 Foldability Errors, 1 Warning');
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

  it('still returns null when the kernel reported nothing to summarise', () => {
    // Distinct from a clean result: no diagnostics at all means the check has
    // not run, and the HUD should not appear rather than claim OK.
    expect(diagnosticHudStatus(t, { ...camv([]), diagnostics: [] })).toBeNull();
  });
});

describe('the fourth tone', () => {
  it('counts undecided vertices apart from vertices nothing can be said about', () => {
    // One has an action — here is the angle that closes it — and the other has
    // an explanation. A single number over both would mean neither.
    const status = diagnosticHudStatus(
      t,
      camv([undecided(1), undecided(2), undecided(3), unexamined(1)])
    );
    expect(status?.tone).toBe('info');
    expect(status?.label).toBe('3 vertices undecided, 1 vertex not checked');
  });

  it('says it under the always-on overlay, where a clean result stays silent', () => {
    // The state the plan is named after. `issueOnly` is what keeps the overlay
    // quiet on a good document, and letting it swallow this would be the bug
    // again: not decided, displayed as decided and fine.
    const status = diagnosticHudStatus(t, camv([undecided(1)]), { issueOnly: true });
    expect(status?.tone).toBe('info');
    expect(status?.label).toBe('1 vertex undecided');
    expect(status?.detail).toBe('Set this crease to -90° and this vertex closes');
  });

  it('leaves the headline to the errors when there are any', () => {
    // Informational rows are not issues, and the headline names issues — the
    // same rule the list's own aria-label already states. What must not happen
    // is 700 undecided vertices burying one error in the count.
    const status = diagnosticHudStatus(t, camv([violation(1), undecided(1), unexamined(1)]));
    expect(status?.tone).toBe('error');
    expect(status?.label).toBe('1 Foldability Error');
  });

  it('is not the warning tone, however many there are', () => {
    const many = Array.from({ length: 700 }, (_, i) => undecided(i + 1));
    expect(diagnosticHudStatus(t, camv(many))?.tone).toBe('info');
    expect(diagnosticHudStatus(t, camv(many))?.label).toBe('700 vertices undecided');
  });
});

describe('a check that examined nothing', () => {
  it('says so instead of OK', () => {
    // Case 8. `known-good/airplane.fold` is twenty vertices, every one on the
    // paper edge, so no foldability condition exists in it at all — and it has
    // always reported clean, which is a claim about vertices it never made.
    const nothing = { ...camv([]), checked_vertices: 0 };
    const status = diagnosticHudStatus(t, nothing);
    expect(status?.tone).toBe('info');
    expect(status?.label).toBe('Foldability: nothing to check');
    expect(status?.detail).toBe('No vertex here has a foldability condition');
  });

  it('still stays quiet under the always-on overlay', () => {
    // Otherwise an empty document wears a permanent badge. The claim belongs to
    // the check the user ran on purpose, which is the one that would otherwise
    // have said "OK".
    expect(diagnosticHudStatus(t, { ...camv([]), checked_vertices: 0 }, { issueOnly: true })).toBe(
      null
    );
  });

  it('reports OK when vertices were checked and are fine', () => {
    expect(diagnosticHudStatus(t, camv([]))?.label).toBe('Foldability OK');
  });

  it('reports OK when the command does not check vertices at all', () => {
    // `checked_vertices` is absent on Check1 and friends, and absent is not
    // zero: a check that never counts must not be read as having counted none.
    const { checked_vertices: _unused, ...noCount } = camv([]);
    expect(diagnosticHudStatus(t, noCount)?.label).toBe('Foldability OK');
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

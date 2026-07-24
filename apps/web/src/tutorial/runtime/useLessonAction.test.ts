import { describe, expect, it } from 'vitest';
import { evaluateLessonPredicate } from './useLessonAction';
import type { OristudioCpCommandResult } from '../../engine/oristudioCpTypes';

function camv(entries: number, diagnostics: string[] = []): OristudioCpCommandResult {
  return {
    operation: 'CheckCamv',
    status: 'OracleTested',
    diagnostics,
    diagnostic_entries: Array.from({ length: entries }, (_, index) => ({
      id: `e${index}`,
      kind: 'CheckCamv',
      severity: 'error',
      message: 'Flat-foldability violation: NumberOfFolds',
    })),
  } as OristudioCpCommandResult;
}

describe('evaluateLessonPredicate', () => {
  it('sees a folded figure once one exists', () => {
    const none = { oristudioCpFoldedFigures: [], oristudioCpCamvResult: null };
    expect(evaluateLessonPredicate('folded-figure-exists', none)).toBe(false);

    const folded = {
      oristudioCpFoldedFigures: [{}] as never,
      oristudioCpCamvResult: null,
    };
    expect(evaluateLessonPredicate('folded-figure-exists', folded)).toBe(true);
  });

  it('treats an un-run check as not-yet-clean rather than clean', () => {
    // Otherwise a lesson step would complete itself before the checker had said
    // anything at all.
    expect(
      evaluateLessonPredicate('camv-clean', {
        oristudioCpFoldedFigures: [],
        oristudioCpCamvResult: null,
      })
    ).toBe(false);
  });

  it('is clean only when there are no entries and no diagnostics', () => {
    const state = (result: OristudioCpCommandResult) => ({
      oristudioCpFoldedFigures: [],
      oristudioCpCamvResult: result,
    });
    expect(evaluateLessonPredicate('camv-clean', state(camv(4, ['found 4 issue(s)'])))).toBe(false);
    expect(evaluateLessonPredicate('camv-clean', state(camv(0, ['found 1 issue'])))).toBe(false);
    expect(evaluateLessonPredicate('camv-clean', state(camv(0)))).toBe(true);
  });
});

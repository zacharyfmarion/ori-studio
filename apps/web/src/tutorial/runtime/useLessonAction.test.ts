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

type PredicateState = Parameters<typeof evaluateLessonPredicate>[1];

/** Nothing has happened yet; each test overrides only the field it is about. */
const EMPTY: PredicateState = {
  oristudioCpFoldedFigures: [],
  oristudioCpInlineSimulations: [],
  oristudioCpCamvResult: null,
};

describe('evaluateLessonPredicate', () => {
  it('sees a folded figure once one exists', () => {
    expect(evaluateLessonPredicate('folded-figure-exists', EMPTY)).toBe(false);
    expect(
      evaluateLessonPredicate('folded-figure-exists', {
        ...EMPTY,
        oristudioCpFoldedFigures: [{}] as never,
      })
    ).toBe(true);
  });

  /**
   * A folded figure and a simulation window are different things — one is the
   * static result, the other the animation — and the folding lesson asks for
   * both in a row, so the two steps must not satisfy each other.
   */
  it('sees an inline simulation only once one is open', () => {
    expect(evaluateLessonPredicate('inline-simulation-exists', EMPTY)).toBe(false);
    expect(
      evaluateLessonPredicate('inline-simulation-exists', {
        ...EMPTY,
        oristudioCpFoldedFigures: [{}] as never,
      })
    ).toBe(false);
    expect(
      evaluateLessonPredicate('inline-simulation-exists', {
        ...EMPTY,
        oristudioCpInlineSimulations: [{}] as never,
      })
    ).toBe(true);
  });

  it('treats an un-run check as not-yet-clean rather than clean', () => {
    // Otherwise a lesson step would complete itself before the checker had said
    // anything at all.
    expect(evaluateLessonPredicate('camv-clean', EMPTY)).toBe(false);
  });

  /**
   * The summary line is what the engine actually returns, and it is present
   * whether or not anything is wrong — a clean pattern reports
   * "Check CAMV found 0 issue(s)". Treating a non-empty `diagnostics` as a
   * failure made the foldability lesson impossible to finish, and this test
   * missed it by inventing a clean result with no summary at all.
   */
  it('reads violations from the entries, not from the summary line', () => {
    const state = (result: OristudioCpCommandResult) => ({
      ...EMPTY,
      oristudioCpCamvResult: result,
    });
    expect(
      evaluateLessonPredicate('camv-clean', state(camv(4, ['Check CAMV found 4 issue(s)'])))
    ).toBe(false);
    expect(
      evaluateLessonPredicate('camv-clean', state(camv(0, ['Check CAMV found 0 issue(s)'])))
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { hasReferencesFindings } from './ReferencesFindingsList';
import type { ReferencesAnalysis } from './referencesAnalysis';
import type { ReferencesPlanRecord } from './referencesResults';

/** A plan record with only what the predicate reads. */
function record(
  findings: number,
  refused: ReferencesPlanRecord['refused'] = []
): ReferencesPlanRecord {
  return {
    components: [
      {
        result: {
          sequence: { findings: Array.from({ length: findings }, () => ({})) },
          approximate: [],
        },
      },
    ],
    refused,
  } as unknown as ReferencesPlanRecord;
}

describe('hasReferencesFindings', () => {
  // The rail mounts its notes only when this answers true, so a plan that
  // constructed every line leaves the rail as the cards alone.
  it('is false for no plan, and for a plan that constructed every line', () => {
    expect(hasReferencesFindings(null, null)).toBe(false);
    expect(hasReferencesFindings(record(0), null)).toBe(false);
  });

  it('is true for a line with no exact fold, a sheet left out, or an analysis', () => {
    expect(hasReferencesFindings(record(1), null)).toBe(true);
    expect(hasReferencesFindings(record(0, [{ component: 1, kind: 'open_outline' }]), null)).toBe(
      true
    );
    expect(hasReferencesFindings(null, {} as ReferencesAnalysis)).toBe(true);
  });
});

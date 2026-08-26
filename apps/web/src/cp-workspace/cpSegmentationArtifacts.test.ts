import { describe, expect, it } from 'vitest';
import { creaseFingerprint } from './cpSegmentationArtifacts';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../lib/foldAngle';

function segment(patch: Partial<OristudioCpLineSegment> = {}): OristudioCpLineSegment {
  return {
    a: { x: 0, y: 0 },
    b: { x: 100, y: 100 },
    active: 'Inactive0',
    color: 'Red1',
    selected: 0,
    customized: 0,
    customized_color: { red: 100, green: 200, blue: 200 },
    ...patch,
  };
}

function snapshot(...lines: OristudioCpLineSegment[]): OristudioCpDocumentSnapshot {
  return { crease_pattern: { line_segments: lines } } as OristudioCpDocumentSnapshot;
}

describe('creaseFingerprint', () => {
  it('is stable for the same geometry', () => {
    expect(creaseFingerprint(snapshot(segment()))).toEqual(
      creaseFingerprint(snapshot(segment()))
    );
  });

  it('changes when an endpoint moves', () => {
    expect(creaseFingerprint(snapshot(segment()))).not.toEqual(
      creaseFingerprint(snapshot(segment({ b: { x: 100, y: 101 } })))
    );
  });

  it('changes when a crease changes colour', () => {
    expect(creaseFingerprint(snapshot(segment({ color: 'Red1' })))).not.toEqual(
      creaseFingerprint(snapshot(segment({ color: 'Blue2' })))
    );
  });

  it('changes when only the fold magnitude changes', () => {
    // The one this cache used to miss. Magnitude and colour are orthogonal by
    // construction (`lib/foldAngle.ts`), so dialling a crease from a full fold to 90
    // moves no endpoint and changes no colour. Keyed on those alone, the cached
    // artifacts — and the `edges_foldAngle` the export and share cards draw from —
    // kept the old angles, and nothing said so.
    const classic = creaseFingerprint(snapshot(segment()));
    const ninety = creaseFingerprint(
      snapshot(segment({ fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }))
    );
    const sixty = creaseFingerprint(
      snapshot(segment({ fold_magnitude: 60 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }))
    );

    expect(ninety).not.toEqual(classic);
    expect(sixty).not.toEqual(ninety);
  });

  it('distinguishes an absent magnitude from an explicit zero', () => {
    // Absent is a classic ±180 crease; 0 is a crease dialled flat. They are different
    // pictures, so they must be different keys.
    expect(creaseFingerprint(snapshot(segment()))).not.toEqual(
      creaseFingerprint(snapshot(segment({ fold_magnitude: 0 })))
    );
  });
});

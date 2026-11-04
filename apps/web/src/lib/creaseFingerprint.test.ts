import { describe, expect, it } from 'vitest';
import { creaseFingerprint, creaseLinesFingerprint, lineContentFingerprint } from './creaseFingerprint';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from './foldAngle';

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

describe('lineContentFingerprint', () => {
  it('ignores which lines are selected', () => {
    expect(lineContentFingerprint(snapshot(segment({ selected: 2 })))).toEqual(
      lineContentFingerprint(snapshot(segment()))
    );
  });

  it('changes with what a crease fingerprint reads that the geometry does not', () => {
    // Each of these leaves `creaseFingerprint` alone — no geometry depends on it —
    // and changes a relative crease fingerprint, so a cache of one must miss.
    const plain = lineContentFingerprint(snapshot(segment()));
    for (const patch of [
      { active: 'ActiveA1' },
      { customized: 1 },
      { customized_color: { red: 1, green: 200, blue: 200 } },
      { color: 'Angle', fold_direction_hint: 'Mountain' as const },
    ]) {
      expect(lineContentFingerprint(snapshot(segment(patch)))).not.toEqual(plain);
    }
    expect(creaseFingerprint(snapshot(segment({ customized: 1 })))).toEqual(
      creaseFingerprint(snapshot(segment()))
    );
  });
});

describe('creaseLinesFingerprint', () => {
  const other = segment({ a: { x: 5, y: 5 }, color: 'Blue2' });

  it('reads only the lines named, by their geometry and kind, whatever their ids', () => {
    const fingerprint = creaseLinesFingerprint(snapshot(segment(), other), [1]);
    // A line added before it renumbers it: chosen under its new id, it fingerprints alike.
    expect(creaseLinesFingerprint(snapshot(other, segment()), [2])).toEqual(fingerprint);
    // Another line changed: nothing of these.
    expect(creaseLinesFingerprint(snapshot(segment(), { ...other, color: 'Red1' }), [1])).toEqual(fingerprint);
  });

  it('ignores a custom colour and a selection, and changes with the geometry, the kind or the magnitude', () => {
    const plain = creaseLinesFingerprint(snapshot(segment()), [1]);
    for (const patch of [{ customized: 1 }, { customized_color: { red: 1, green: 2, blue: 3 } }, { selected: 2 }]) {
      expect(creaseLinesFingerprint(snapshot(segment(patch)), [1])).toEqual(plain);
    }
    for (const patch of [{ b: { x: 100, y: 101 } }, { color: 'Blue2' }, { fold_magnitude: 90 }]) {
      expect(creaseLinesFingerprint(snapshot(segment(patch)), [1])).not.toEqual(plain);
    }
  });

  it('is null for an id that names no line', () => {
    expect(creaseLinesFingerprint(snapshot(segment()), [2])).toBeNull();
  });
});


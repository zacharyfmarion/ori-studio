import { describe, expect, it } from 'vitest';
import type { OristudioCpDocumentSnapshot, OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
import { linesSheetThumbnail } from './linesSheetThumbnail';
import {
  MAX_STORED_STROKES,
  fitSheetThumbnail,
  isNewerSheetThumbnail,
  readSheetThumbnail,
  storedSheetThumbnail,
  withinStoredBudget,
  type SheetStroke,
} from './sheetThumbnail';

const stroke = (x1: number, y1: number, x2: number, y2: number, role: SheetStroke['role'] = 'mountain') => ({
  x1,
  y1,
  x2,
  y2,
  role,
});

describe('withinStoredBudget', () => {
  it('leaves a thumbnail under the cap as it is', () => {
    const strokes = [stroke(0, 0, 0, 0), stroke(0, 0, 1, 1), stroke(0, 0, 1, 1)];
    expect(withinStoredBudget(strokes)).toEqual(strokes);
  });

  it('drops dots and repeats first, then the shortest creases, never the edge, in order', () => {
    const edges = Array.from({ length: 10 }, (_, index) => stroke(index, 0, index, 100, 'edge'));
    const dots = Array.from({ length: MAX_STORED_STROKES }, () => stroke(5, 5, 5, 5));
    const repeats = Array.from({ length: 10 }, () => stroke(0, 0, 50, 50, 'valley'));
    const short = Array.from({ length: MAX_STORED_STROKES }, (_, index) =>
      stroke(index / 1000, 0, index / 1000, 1)
    );
    const long = stroke(0, 0, 100, 100, 'mountain');
    const kept = withinStoredBudget([...edges, ...dots, ...repeats, ...short, long]);
    expect(kept).toHaveLength(MAX_STORED_STROKES);
    expect(kept.slice(0, 10)).toEqual(edges);
    expect(kept.filter((entry) => entry.x1 === 5 && entry.y1 === 5 && entry.x2 === 5)).toEqual([]);
    expect(kept.filter((entry) => entry.role === 'valley')).toHaveLength(1);
    expect(kept.at(-1)).toEqual(long);
  });
});

/** A unit square's border with a mountain diagonal, and a valley across it folded to `valleyMagnitude`. */
function snapshot(valleyMagnitude?: number): OristudioCpDocumentSnapshot {
  const line = (ax: number, ay: number, bx: number, by: number, color: string, extra: Partial<OristudioCpLineSegment> = {}) =>
    ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, color, ...extra }) as OristudioCpLineSegment;
  return {
    crease_pattern: {
      line_segments: [
        line(0, 0, 10, 0, 'Black0'),
        line(10, 0, 10, 10, 'Black0'),
        line(10, 10, 0, 10, 'Black0'),
        line(0, 10, 0, 0, 'Black0'),
        line(0, 0, 10, 10, 'Red1'),
        line(0, 10, 10, 0, 'Blue2', valleyMagnitude === undefined ? {} : { fold_magnitude: valleyMagnitude }),
      ],
    },
    metadata: {},
  } as unknown as OristudioCpDocumentSnapshot;
}

const ALL_LINES = [1, 2, 3, 4, 5, 6];

describe('a crease folded short of 180° in a thumbnail', () => {
  it('carries its angle from the document’s line, and only that line does', () => {
    const thumbnail = linesSheetThumbnail(snapshot(90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE), ALL_LINES);
    const partial = thumbnail?.strokes.filter((entry) => entry.foldDegrees !== undefined) ?? [];
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({ role: 'valley', foldDegrees: 90 });
  });

  it('leaves a flat pattern’s thumbnail exactly as it was: no stroke has the field at all', () => {
    const flat = linesSheetThumbnail(snapshot(), ALL_LINES);
    for (const entry of flat?.strokes ?? []) expect(Object.keys(entry).sort()).toEqual(['role', 'x1', 'x2', 'y1', 'y2']);
    // Nor does a stored one, so a file with no 3D pattern is written as before.
    expect(JSON.stringify(storedSheetThumbnail(flat))).not.toContain('foldDegrees');
  });

  it('keeps the angle through fitting and storing, unsnapped so it never rounds up to a full fold', () => {
    const fitted = fitSheetThumbnail([stroke(0, 0, 3, 3), { ...stroke(0, 3, 3, 0, 'valley'), foldDegrees: 179.96 }]);
    expect(fitted?.strokes.find((entry) => entry.role === 'valley')?.foldDegrees).toBe(179.96);
    const stored = storedSheetThumbnail(fitted);
    expect(stored.strokes.find((entry) => entry.role === 'valley')?.foldDegrees).toBe(179.96);
    expect(stored.strokes.find((entry) => entry.role === 'mountain')).not.toHaveProperty('foldDegrees');
  });

  it('reads back as written, and is no newer build’s field', () => {
    const stored = storedSheetThumbnail(linesSheetThumbnail(snapshot(45 * FOLD_MAGNITUDE_UNITS_PER_DEGREE), ALL_LINES));
    const json = JSON.parse(JSON.stringify(stored)) as unknown;
    expect(isNewerSheetThumbnail(json)).toBe(false);
    expect(readSheetThumbnail(json)).toEqual(stored);
  });

  it('refuses a thumbnail whose angle is not one, rather than draw that crease as a full fold', () => {
    const at = (foldDegrees: unknown) => ({
      viewBox: '0 0 100 100',
      strokes: [{ x1: 0, y1: 0, x2: 100, y2: 100, role: 'valley', foldDegrees }],
    });
    expect(readSheetThumbnail(at(0))?.strokes[0]?.foldDegrees).toBe(0);
    for (const bad of [180, -1, Number.NaN, '90', null]) expect(readSheetThumbnail(at(bad))).toBeNull();
  });
});

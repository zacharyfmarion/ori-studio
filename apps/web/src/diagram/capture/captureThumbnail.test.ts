import { describe, expect, it } from 'vitest';
import {
  MAX_STORED_STROKES,
  readSheetThumbnail,
  type SheetStroke,
} from '../../cp-workspace/sheets/sheetThumbnail';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { storedCpSource } from '../document/diagramFile';
import { cpDocument, twoSquaresSegmentation } from './capture.fixtures';
import { chooseStepCreases } from './captureCreases';
import { creasesThumbnail, withinStoredBudget } from './captureThumbnail';

const stroke = (x1: number, y1: number, x2: number, y2: number, role: SheetStroke['role'] = 'mountain') => ({
  x1,
  y1,
  x2,
  y2,
  role,
});

describe('creasesThumbnail', () => {
  it('draws the region from the segmentation it was found in, snapped, and the file reads it back', () => {
    const segmentation = twoSquaresSegmentation();
    const [left] = resolveCpSegments(segmentation);
    const scope = { kind: 'segment' as const, region: regionReferenceFor(left!) };
    const choice = chooseStepCreases(cpDocument(), scope, segmentation);
    if (choice.status !== 'found') throw new Error('the left square is a region');
    const thumbnail = creasesThumbnail(choice.creases, segmentation);
    expect(thumbnail.strokes.length).toBeGreaterThan(0);
    // To a tenth of the box, so the file stays short.
    for (const entry of thumbnail.strokes) {
      for (const value of [entry.x1, entry.y1, entry.x2, entry.y2]) {
        expect(Math.round(value * 10) / 10).toBe(value);
      }
    }
    expect(readSheetThumbnail(thumbnail)).not.toBeNull();
    expect(
      storedCpSource({
        kind: 'cp',
        scope,
        fingerprint: choice.creases.fingerprint,
        thumbnail,
        render: { mode: 'crease-pattern', rotationDeg: 0 },
      })
    ).not.toBeNull();
  });
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

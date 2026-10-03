import { describe, expect, it } from 'vitest';
import {
  MAX_STORED_STROKES,
  readSheetThumbnail,
  type SheetStroke,
} from '../../cp-workspace/sheets/sheetThumbnail';
import { storedCpSource } from '../document/diagramFile';
import { cpDocument, type FixtureLine } from './capture.fixtures';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { StepCreases } from './captureCreases';
import { creasesThumbnail, withinStoredBudget } from './captureThumbnail';

const stroke = (x1: number, y1: number, x2: number, y2: number, role: SheetStroke['role'] = 'mountain') => ({
  x1,
  y1,
  x2,
  y2,
  role,
});

describe('creasesThumbnail', () => {
  // A link the file cannot read back is no link: Link, Refresh and every Pose
  // verb failed on a pattern dense enough to pass the reader's stroke cap.
  it('keeps a dense pattern’s thumbnail within what the file reads back', () => {
    const border: FixtureLine[] = [
      [0, 0, 400, 0, 'Black0'],
      [400, 0, 400, 400, 'Black0'],
      [400, 400, 0, 400, 'Black0'],
      [0, 400, 0, 0, 'Black0'],
    ];
    // 20,100 creases, more than the cap: a grid of short ones and a few long ones.
    const dense: FixtureLine[] = Array.from({ length: 20_100 }, (_, index) => {
      const x = 1 + (index % 140) * 2.8;
      const y = 1 + Math.floor(index / 140) * 2.7;
      return index < 5 ? [0, index * 50 + 10, 400, index * 50 + 10, 'Red1'] : [x, y, x + 1, y + 1, 'Blue2'];
    });
    const document = cpDocument([...border, ...dense]);
    const rim = [
      [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 400 },
        { x: 0, y: 400 },
      ],
    ];
    const scope = {
      kind: 'segment' as const,
      region: { boundary: rim, bounds: { minX: 0, minY: 0, maxX: 400, maxY: 400 }, segmentIdHint: 0 },
    };
    // Drawn from its lines, as it is while the segmentation is not to hand.
    const lineIds = document.crease_pattern.line_segments.map((_, index) => index + 1);
    const creases: StepCreases = {
      scopedLineIds: lineIds,
      foldLineIds: lineIds,
      fingerprint: 'fp',
      drawnFingerprint: 'fp',
      paper: rim,
      segment: { id: 0, boundary: rim } as unknown as CpSegment,
    };
    const thumbnail = creasesThumbnail(document, creases, null);
    expect(thumbnail.strokes.length).toBeLessThanOrEqual(MAX_STORED_STROKES);
    expect(readSheetThumbnail(thumbnail)).not.toBeNull();
    // The sheet's edge and the long folds are what it keeps.
    expect(thumbnail.strokes.filter((entry) => entry.role === 'edge')).toHaveLength(4);
    expect(thumbnail.strokes.filter((entry) => entry.role === 'mountain')).toHaveLength(5);
    expect(
      storedCpSource({
        kind: 'cp',
        scope,
        fingerprint: creases.fingerprint,
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

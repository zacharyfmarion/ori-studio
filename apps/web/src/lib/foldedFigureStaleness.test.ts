import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import {
  cpLinesByIds,
  foldedSourceBounds,
  foldedSourceFingerprint,
  isFoldedFigureStale,
  reselectFoldableLineIds,
  segmentOverlapsBounds,
} from './foldedFigureStaleness';

function line(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color = 'Black0',
  overrides: Partial<OristudioCpLineSegment> = {}
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: '',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...overrides,
  } as OristudioCpLineSegment;
}

function doc(lines: OristudioCpLineSegment[]): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: {
      line_segments: lines,
      circles: [],
      points: [],
      aux_line_segments: [],
      texts: [],
      grid: {},
    },
    metadata: {},
  } as unknown as OristudioCpDocumentSnapshot;
}

// A unit square of border creases plus one interior mountain fold.
const SQUARE: OristudioCpLineSegment[] = [
  line(0, 0, 1, 0),
  line(1, 0, 1, 1),
  line(1, 1, 0, 1),
  line(0, 1, 0, 0),
  line(0, 0, 1, 1, 'Red1'),
];
const SQUARE_IDS = [1, 2, 3, 4, 5];

function figureFrom(
  document: OristudioCpDocumentSnapshot,
  lineIds: number[],
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  const bounds = foldedSourceBounds(cpLinesByIds(document, lineIds));
  const reselected = cpLinesByIds(document, reselectFoldableLineIds(document, bounds));
  return {
    id: 'folded-1',
    sourceKind: 'generated-from-current-cp',
    status: 'ready',
    sourceBounds: bounds,
    sourceFingerprint: foldedSourceFingerprint(reselected),
    sourceLineIds: lineIds,
    ...overrides,
  } as unknown as OristudioCpFoldedFigureEntry;
}

describe('foldedSourceBounds', () => {
  // Port of GetBoundingBox.getBoundingBox.
  it('spans every endpoint of the folded set', () => {
    expect(foldedSourceBounds(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it('is null for an empty set', () => {
    expect(foldedSourceBounds([])).toBeNull();
  });
});

describe('segmentOverlapsBounds', () => {
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  // Oriedita's totu_boundary_inside returns true when *any part* of the segment
  // touches the region, not when the segment is contained by it: it tests
  // intersection with each boundary edge, then falls back to "is the midpoint
  // inside". These cases pin that meaning.
  it('accepts a segment wholly inside', () => {
    expect(segmentOverlapsBounds(line(2, 2, 8, 8), bounds)).toBe(true);
  });

  it('accepts a segment that merely crosses the region', () => {
    // Neither endpoint is inside, but the segment passes straight through.
    expect(segmentOverlapsBounds(line(-5, 5, 15, 5), bounds)).toBe(true);
  });

  it('accepts a segment with one endpoint inside', () => {
    expect(segmentOverlapsBounds(line(5, 5, 50, 50), bounds)).toBe(true);
  });

  it('accepts a segment lying along the boundary', () => {
    expect(segmentOverlapsBounds(line(0, 0, 0, 10), bounds)).toBe(true);
  });

  it('rejects a segment entirely outside', () => {
    expect(segmentOverlapsBounds(line(20, 20, 30, 30), bounds)).toBe(false);
  });

  it('rejects a segment parallel to and beyond an edge', () => {
    expect(segmentOverlapsBounds(line(-5, 20, 15, 20), bounds)).toBe(false);
  });

  it('handles a degenerate point segment', () => {
    expect(segmentOverlapsBounds(line(5, 5, 5, 5), bounds)).toBe(true);
    expect(segmentOverlapsBounds(line(50, 50, 50, 50), bounds)).toBe(false);
  });
});

describe('reselectFoldableLineIds', () => {
  it('re-derives the folded set from the recorded region', () => {
    const document = doc(SQUARE);
    const bounds = foldedSourceBounds(SQUARE);
    expect(reselectFoldableLineIds(document, bounds)).toEqual(SQUARE_IDS);
  });

  it('skips auxiliary colours, matching getSaveForSelectFolding', () => {
    // Cyan3 is an auxiliary line: is_folding_line() is false upstream.
    const document = doc([...SQUARE, line(0.2, 0.2, 0.8, 0.8, 'Cyan3')]);
    expect(reselectFoldableLineIds(document, foldedSourceBounds(SQUARE))).toEqual(SQUARE_IDS);
  });

  it('picks up a crease added inside the region since the fold', () => {
    const document = doc([...SQUARE, line(0.2, 0.2, 0.8, 0.2, 'Blue2')]);
    expect(reselectFoldableLineIds(document, foldedSourceBounds(SQUARE))).toEqual([
      ...SQUARE_IDS,
      6,
    ]);
  });

  it('ignores creases outside the region', () => {
    const document = doc([...SQUARE, line(5, 5, 6, 6)]);
    expect(reselectFoldableLineIds(document, foldedSourceBounds(SQUARE))).toEqual(SQUARE_IDS);
  });

  it('returns nothing without a document or a region', () => {
    expect(reselectFoldableLineIds(null, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toEqual([]);
    expect(reselectFoldableLineIds(doc(SQUARE), null)).toEqual([]);
  });
});

describe('foldedSourceFingerprint', () => {
  // Port of LineSegmentSet.contentEquals: equal counts, same members, order
  // irrelevant.
  it('ignores ordering', () => {
    expect(foldedSourceFingerprint(SQUARE)).toBe(foldedSourceFingerprint([...SQUARE].reverse()));
  });

  it('changes when an endpoint moves', () => {
    const moved = [line(0, 0, 1.5, 0), ...SQUARE.slice(1)];
    expect(foldedSourceFingerprint(moved)).not.toBe(foldedSourceFingerprint(SQUARE));
  });

  it('changes when a crease changes colour', () => {
    const recoloured = [line(0, 0, 1, 1, 'Blue2'), ...SQUARE.slice(1)];
    expect(foldedSourceFingerprint(recoloured)).not.toBe(foldedSourceFingerprint(SQUARE));
  });

  it('changes when a crease is added or removed', () => {
    expect(foldedSourceFingerprint(SQUARE.slice(1))).not.toBe(foldedSourceFingerprint(SQUARE));
  });

  it('distinguishes duplicate creases by multiplicity', () => {
    expect(foldedSourceFingerprint([...SQUARE, SQUARE[0]!])).not.toBe(
      foldedSourceFingerprint(SQUARE)
    );
  });

  // Upstream compares `selected` too, but only ever between sets that came from
  // getSaveForSelectFolding, where it is uniformly 2. Ours varies with the
  // user's clicks, so including it would report every figure stale on selection.
  it('ignores selection state', () => {
    const selected = SQUARE.map((segment) => ({ ...segment, selected: 2 }));
    expect(foldedSourceFingerprint(selected)).toBe(foldedSourceFingerprint(SQUARE));
  });
});

describe('isFoldedFigureStale', () => {
  it('is false for a figure that still matches its creases', () => {
    const document = doc(SQUARE);
    expect(isFoldedFigureStale(document, figureFrom(document, SQUARE_IDS))).toBe(false);
  });

  it('is true when one of its creases moves', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const edited = doc([...SQUARE.slice(0, 4), line(0, 0, 0.5, 0.5, 'Red1')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(true);
  });

  it('is true when a crease is added inside its region', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const edited = doc([...SQUARE, line(0.2, 0.2, 0.8, 0.2, 'Blue2')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(true);
  });

  it('is true when one of its creases is recoloured', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const edited = doc([...SQUARE.slice(0, 4), line(0, 0, 1, 1, 'Blue2')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(true);
  });

  // The case the old always-stale flag got wrong: any edit anywhere marked every
  // figure out of date, including edits nowhere near it.
  it('is false for an edit outside its region', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const edited = doc([...SQUARE, line(5, 5, 6, 6), line(6, 6, 7, 7, 'Red1')]);
    expect(isFoldedFigureStale(edited, figure)).toBe(false);
  });

  it('is false when creases are merely selected', () => {
    const document = doc(SQUARE);
    const figure = figureFrom(document, SQUARE_IDS);
    const selected = doc(SQUARE.map((segment) => ({ ...segment, selected: 2 })));
    expect(isFoldedFigureStale(selected, figure)).toBe(false);
  });

  it('is false without recorded provenance, so no refold is offered', () => {
    const document = doc(SQUARE);
    const legacy = figureFrom(document, SQUARE_IDS, {
      sourceBounds: null,
      sourceFingerprint: null,
    });
    const edited = doc(SQUARE.slice(1));
    expect(isFoldedFigureStale(edited, legacy)).toBe(false);
  });

  it('is false for an imported folded form, which has no creases here', () => {
    const document = doc(SQUARE);
    const imported = figureFrom(document, SQUARE_IDS, {
      sourceKind: 'imported-folded-form',
    });
    expect(isFoldedFigureStale(doc(SQUARE.slice(1)), imported)).toBe(false);
  });

  it('is false without a document', () => {
    const document = doc(SQUARE);
    expect(isFoldedFigureStale(null, figureFrom(document, SQUARE_IDS))).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';
import type { FoldDocument } from '../engine/types';
import { segmentFoldDocument } from './creasePatternSegmentation';
import {
  applyCpModelToFold,
  cpModelToFoldTransform,
  foldableLineIdsForSegment,
  foldSegmentForExport,
  type CreaseExportFoldRuntime,
} from './creaseExportFold';

/** Two disjoint squares, matching the document below line for line. */
function twoPatternFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [30, 0],
      [40, 0],
      [40, 10],
      [30, 10],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [4, 6],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M', 'B', 'B', 'B', 'B', 'V'],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
      [4, 5, 6],
      [4, 6, 7],
    ],
  };
}

function line(ax: number, ay: number, bx: number, by: number, color: 'Black0' | 'Red1' | 'Cyan4') {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, color };
}

function document(): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: {
      line_segments: [
        // Pattern 1 (ids 1-5).
        line(0, 0, 10, 0, 'Black0'),
        line(10, 0, 10, 10, 'Black0'),
        line(10, 10, 0, 10, 'Black0'),
        line(0, 10, 0, 0, 'Black0'),
        line(0, 0, 10, 10, 'Red1'),
        // Pattern 2 (ids 6-10).
        line(30, 0, 40, 0, 'Black0'),
        line(40, 0, 40, 10, 'Black0'),
        line(40, 10, 30, 10, 'Black0'),
        line(30, 10, 30, 0, 'Black0'),
        line(30, 0, 40, 10, 'Red1'),
        // An auxiliary line inside pattern 1: drawn, but not foldable.
        line(2, 2, 8, 8, 'Cyan4'),
      ],
    },
    metadata: {},
  } as unknown as OristudioCpDocumentSnapshot;
}

function snapshot(): OristudioCpFoldedRenderSnapshot {
  return {
    schema_version: 1,
    fixture: null,
    pass: null,
    primitives: [
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: {
          paint: { kind: 'color', color: { red: 255, green: 255, blue: 255, alpha: 255 } },
          stroke: { kind: 'none' },
          antialias: 'default',
        },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      },
    ],
  };
}

/** The kernel's paper scene for the same fold: one face, the sheet as it is. */
function paperScene(): OristudioCpFoldedPaperScene {
  const outline = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ];
  return {
    schema_version: 2,
    flipped: false,
    sheet: 1,
    faces: [
      {
        outline,
        points: [0, 1, 2],
        front_up: true,
        edges: outline.map((from, index) => ({
          from,
          to: outline[(index + 1) % outline.length]!,
          kind: 'border' as const,
        })),
      },
    ],
    subfaces: [{ polygon: outline, faces_top_to_bottom: [0] }],
    aux_lines: [],
  };
}

function runtime(overrides: Partial<CreaseExportFoldRuntime> = {}): CreaseExportFoldRuntime {
  return {
    fold: vi.fn(async () => ({ handle: 7, discoveredCases: 1, displayStyle: 'Paper5' as const })),
    foldToCase: vi.fn(async () => ({
      discoveredCases: 3,
      // Advancing a case can leave the estimate at a lower style.
      displayStyle: 'Transparent3' as const,
    })),
    renderSnapshot: vi.fn(async () => snapshot()),
    paperScene: vi.fn(async () => paperScene()),
    free: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('foldableLineIdsForSegment', () => {
  it('picks the foldable lines of one pattern', () => {
    const segments = segmentFoldDocument(twoPatternFold());
    expect(segments).toHaveLength(2);

    const first = foldableLineIdsForSegment(document(), segments[0]!);
    const second = foldableLineIdsForSegment(document(), segments[1]!);

    // The auxiliary line (id 11) sits inside pattern 1 but is not foldable.
    expect(first).toEqual([1, 2, 3, 4, 5]);
    expect(second).toEqual([6, 7, 8, 9, 10]);
  });

  it('takes every foldable line when no segment is given', () => {
    expect(foldableLineIdsForSegment(document(), null)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

/**
 * The same two squares after the import pipeline's rescale into the unit
 * square — what a freshly opened file hands the export dialog.
 */
function importedTwoPatternFold(): FoldDocument {
  const fold = twoPatternFold();
  // normalizePoints: uniform scale by the larger span, then centre.
  const scale = 1 / 40;
  const offsetY = (1 - 10 / 40) / 2;
  return {
    ...fold,
    vertices_coords: fold.vertices_coords.map(([x, y]) => [x! * scale, y! * scale + offsetY]),
  };
}

describe('cpModelToFoldTransform', () => {
  it('is the identity when the fold already carries kernel coordinates', () => {
    const transform = cpModelToFoldTransform(twoPatternFold(), document());

    expect(transform.scale).toBeCloseTo(1, 10);
    expect(transform.offsetX).toBeCloseTo(0, 10);
    expect(transform.offsetY).toBeCloseTo(0, 10);
  });

  it('recovers the import pipeline rescale', () => {
    const transform = cpModelToFoldTransform(importedTwoPatternFold(), document());

    expect(transform.scale).toBeCloseTo(1 / 40, 10);
    expect(applyCpModelToFold({ x: 0, y: 0 }, transform)).toEqual({
      x: expect.closeTo(0, 10),
      y: expect.closeTo((1 - 10 / 40) / 2, 10),
    });
  });
});

describe('foldableLineIdsForSegment across coordinate spaces', () => {
  it('attributes creases to a pattern of an imported fold', () => {
    const fold = importedTwoPatternFold();
    const segments = segmentFoldDocument(fold);
    const transform = cpModelToFoldTransform(fold, document());

    // Without the transform the document's creases are nowhere near the
    // segment, which is what refused the fold on a freshly opened file.
    expect(foldableLineIdsForSegment(document(), segments[1]!)).toEqual([]);
    expect(foldableLineIdsForSegment(document(), segments[1]!, transform)).toEqual([
      6, 7, 8, 9, 10,
    ]);
  });
});

describe('foldSegmentForExport', () => {
  it('folds the segment and frees the handle', async () => {
    const segments = segmentFoldDocument(twoPatternFold());
    const api = runtime();

    await expect(foldSegmentForExport(api, document(), segments[1]!)).resolves.toMatchObject({
      snapshot: { primitives: expect.any(Array) },
      scene: { faces: expect.any(Array), subfaces: expect.any(Array) },
      discoveredCases: 1,
    });

    expect(api.fold).toHaveBeenCalledWith(1, 'Order5', undefined, [6, 7, 8, 9, 10]);
    expect(api.paperScene).toHaveBeenCalledWith(7);
    expect(api.free).toHaveBeenCalledWith(7);
  });

  it('carries a null scene when the kernel has no paper picture for the fold', async () => {
    const api = runtime({ paperScene: vi.fn(async () => null) });

    await expect(foldSegmentForExport(api, document(), null)).resolves.toMatchObject({
      snapshot: { primitives: expect.any(Array) },
      scene: null,
    });
    expect(api.free).toHaveBeenCalledWith(7);
  });

  it('frees the handle when reading the scene fails', async () => {
    const api = runtime({
      paperScene: vi.fn(async () => {
        throw new Error('no such handle');
      }),
    });

    await expect(foldSegmentForExport(api, document(), null)).rejects.toThrow('no such handle');
    expect(api.free).toHaveBeenCalledWith(7);
  });

  it('frees the handle when rendering fails', async () => {
    const api = runtime({
      renderSnapshot: vi.fn(async () => {
        throw new Error('kernel exploded');
      }),
    });

    await expect(foldSegmentForExport(api, document(), null)).rejects.toThrow('kernel exploded');
    expect(api.free).toHaveBeenCalledWith(7);
  });

  it('frees the handle when the figure draws nothing', async () => {
    const api = runtime({ renderSnapshot: vi.fn(async () => null) });

    await expect(foldSegmentForExport(api, document(), null)).rejects.toThrow(/nothing to draw/);
    expect(api.free).toHaveBeenCalledWith(7);
  });

  it('advances to a later fold case before rendering', async () => {
    const api = runtime();

    await expect(
      foldSegmentForExport(api, document(), null, undefined, 3)
    ).resolves.toMatchObject({ discoveredCases: 3 });

    expect(api.foldToCase).toHaveBeenCalledWith(7, 3);
    expect(api.renderSnapshot).toHaveBeenCalledWith(7, 'Transparent3');
    expect(api.free).toHaveBeenCalledWith(7);
  });

  it('renders at the style the estimate reached, not always Paper5', async () => {
    const api = runtime({
      fold: vi.fn(async () => ({
        handle: 7,
        discoveredCases: 1,
        displayStyle: 'Transparent3' as const,
      })),
    });

    await foldSegmentForExport(api, document(), null);

    expect(api.renderSnapshot).toHaveBeenCalledWith(7, 'Transparent3');
  });

  it('reads no scene for a fold that did not reach Paper5', async () => {
    // `Transparent3` after an `Order5` request is the kernel's own downgrade:
    // no layer ordering, or a contradiction. The scene is the `Paper5`
    // picture, so asking for it would at best repeat the failed search and at
    // worst re-raise the contradiction the fold concluded gracefully with.
    const api = runtime({
      fold: vi.fn(async () => ({
        handle: 7,
        discoveredCases: 1,
        displayStyle: 'Transparent3' as const,
      })),
    });

    await expect(foldSegmentForExport(api, document(), null)).resolves.toMatchObject({
      snapshot: { primitives: expect.any(Array) },
      scene: null,
    });
    expect(api.paperScene).not.toHaveBeenCalled();
    expect(api.free).toHaveBeenCalledWith(7);
  });

  it('refuses to fold a pattern with no foldable creases', async () => {
    const api = runtime();
    const auxOnly = {
      crease_pattern: { line_segments: [line(0, 0, 1, 1, 'Cyan4')] },
      metadata: {},
    } as unknown as OristudioCpDocumentSnapshot;

    await expect(foldSegmentForExport(api, auxOnly, null)).rejects.toThrow(/no foldable creases/);
    expect(api.fold).not.toHaveBeenCalled();
  });
});

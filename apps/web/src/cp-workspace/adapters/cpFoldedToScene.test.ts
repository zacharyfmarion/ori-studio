import { describe, expect, it } from 'vitest';
import { cpFoldedToScene, foldedFigureUserBounds } from './cpFoldedToScene';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedRenderPrimitive,
} from '../../engine/oristudioCpTypes';

function figure(primitives: OristudioCpFoldedRenderPrimitive[]): OristudioCpFoldedFigureEntry {
  return {
    id: 'f1',
    title: 'f1',
    handle: null,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: null,
    startingFaceId: null,
    displayStyle: 'preview' as OristudioCpFoldedFigureEntry['displayStyle'],
    status: 'ready',
    snapshot: null,
    renderSnapshot: { schema_version: 1, fixture: null, pass: null, primitives },
    error: null,
  };
}

const solid = (r: number, g: number, b: number, a: number) =>
  ({ kind: 'color', color: { red: r, green: g, blue: b, alpha: a } }) as const;

describe('cpFoldedToScene', () => {
  it('triangulates a fill polygon into fill vertices', () => {
    const geo = cpFoldedToScene([
      figure([
        {
          sequence: 0,
          kind: 'fill_polygon',
          style: { paint: solid(255, 0, 0, 255), stroke: { kind: 'none' }, antialias: 'default' },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        },
      ]),
    ]);
    // a quad triangulates into 2 triangles = 6 vertices
    expect(geo.fills.count).toBe(6);
    expect(geo.strokes.count).toBe(0);
    // red, full alpha
    expect(geo.fills.color[0]).toBeCloseTo(1);
    expect(geo.fills.color[3]).toBeCloseTo(1);
  });

  it('emits edge segments for a stroke polygon', () => {
    const geo = cpFoldedToScene([
      figure([
        {
          sequence: 0,
          kind: 'stroke_polygon',
          style: {
            paint: solid(0, 0, 0, 255),
            stroke: { kind: 'basic', width: 2, end_cap: 0, line_join: 0, miter_limit: 4 },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 4, y: 4 },
            ],
          },
        },
      ]),
    ]);
    expect(geo.fills.count).toBe(0);
    expect(geo.strokes.count).toBe(2); // 3 points -> 2 segments
    expect(geo.strokes.widthMul[0]).toBeCloseTo(2);
  });

  it('skips figures without a render snapshot', () => {
    const geo = cpFoldedToScene([{ ...figure([]), renderSnapshot: null }]);
    expect(geo.fills.count).toBe(0);
    expect(geo.strokes.count).toBe(0);
  });
});

const strokeTriangle = () =>
  figure([
    {
      sequence: 0,
      kind: 'stroke_polygon',
      style: {
        paint: solid(0, 0, 0, 255),
        stroke: { kind: 'basic', width: 1, end_cap: 0, line_join: 0, miter_limit: 4 },
        antialias: 'default',
      },
      geometry: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 8, y: 8 },
        ],
      },
    },
  ]);

describe('cpFoldedToScene scale preview', () => {
  it('scales the targeted figure about the pivot (user coords)', () => {
    const base = cpFoldedToScene([strokeTriangle()]);
    const pivot = { x: 5, y: 5 };
    const factor = 2;
    const preview = cpFoldedToScene([strokeTriangle()], { figureId: 'f1', factor, pivot });

    expect(preview.strokes.count).toBe(base.strokes.count);
    for (let i = 0; i < base.strokes.count * 2; i += 2) {
      expect(preview.strokes.a[i]).toBeCloseTo(pivot.x + (base.strokes.a[i] - pivot.x) * factor);
      expect(preview.strokes.a[i + 1]).toBeCloseTo(
        pivot.y + (base.strokes.a[i + 1] - pivot.y) * factor
      );
    }
  });

  it('leaves a non-targeted figure unchanged', () => {
    const base = cpFoldedToScene([strokeTriangle()]);
    const preview = cpFoldedToScene([strokeTriangle()], {
      figureId: 'other',
      factor: 3,
      pivot: { x: 0, y: 0 },
    });
    expect(Array.from(preview.strokes.a)).toEqual(Array.from(base.strokes.a));
    expect(Array.from(preview.strokes.b)).toEqual(Array.from(base.strokes.b));
  });
});

describe('foldedFigureUserBounds', () => {
  const polygonFigure = () =>
    figure([
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: { paint: solid(255, 0, 0, 255), stroke: { kind: 'none' }, antialias: 'default' },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      },
    ]);

  it('returns one non-empty bounds per drawable figure', () => {
    const [entry, ...rest] = foldedFigureUserBounds([polygonFigure()]);
    expect(rest).toHaveLength(0);
    expect(entry.id).toBe('f1');
    expect(entry.bounds.maxX).toBeGreaterThan(entry.bounds.minX);
    expect(entry.bounds.maxY).toBeGreaterThan(entry.bounds.minY);
  });

  it('shifts bounds by the display offset', () => {
    const base = foldedFigureUserBounds([polygonFigure()])[0].bounds;
    const shifted = foldedFigureUserBounds([
      { ...polygonFigure(), displayOffset: { x: 100, y: 50 } },
    ])[0].bounds;
    expect(shifted.minX - base.minX).toBeCloseTo(100);
    expect(shifted.maxX - base.maxX).toBeCloseTo(100);
    expect(shifted.minY - base.minY).toBeCloseTo(50);
    expect(shifted.maxY - base.maxY).toBeCloseTo(50);
  });

  it('omits figures with no drawable geometry', () => {
    expect(foldedFigureUserBounds([figure([])])).toHaveLength(0);
    expect(foldedFigureUserBounds([{ ...figure([]), renderSnapshot: null }])).toHaveLength(0);
  });
});

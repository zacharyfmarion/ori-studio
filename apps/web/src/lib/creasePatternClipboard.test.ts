import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import {
  buildCpLineClipboardPayload,
  cpLineSelectionBounds,
  cpLineSelectionFrame,
  cpLineSelectionMoveAnchorPoints,
  offsetCpLineSegmentsForPaste,
  rotationAngleFromCenter,
  snapRotationDegrees,
  translateCpLineSegments,
  transformCpLineSegments,
} from './creasePatternClipboard';
import { emptyOristudioCpSelection } from './creasePatternViewport';

function cpLine(
  a: { x: number; y: number },
  b: { x: number; y: number },
  overrides: Partial<OristudioCpLineSegment> = {},
): OristudioCpLineSegment {
  return {
    a,
    b,
    active: 'Inactive0',
    color: 'Red1',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...overrides,
  };
}

function documentWithLines(lines: OristudioCpLineSegment[]): OristudioCpDocumentSnapshot {
  return {
    title: 'selection',
    metadata: {},
    crease_pattern: {
      line_segments: lines,
      aux_line_segments: [],
      circles: [],
      points: [],
      texts: [],
      grid: {
        interval_grid_size: 4,
        grid_size: 8,
        grid_xa: 1,
        grid_xb: 0,
        grid_xc: 1,
        grid_ya: 1,
        grid_yb: 0,
        grid_yc: 1,
        grid_angle: 90,
        base_state: 'WithinPaper',
        vertical_scale_position: 0,
        horizontal_scale_position: 0,
        draw_diagonal_gridlines: false,
      },
    },
  };
}

describe('crease-pattern clipboard geometry', () => {
  it('builds selected-line payloads with content bounds', () => {
    const payload = buildCpLineClipboardPayload(
      documentWithLines([
        cpLine({ x: 0, y: 0 }, { x: 2, y: 0 }),
        cpLine({ x: -1, y: 3 }, { x: 1, y: 4 }),
      ]),
      {
        ...emptyOristudioCpSelection(),
        lines: [2],
      },
    );

    expect(payload).toMatchObject({
      kind: 'cp-lines',
      lines: [{ a: { x: -1, y: 3 }, b: { x: 1, y: 4 } }],
      bounds: {
        minX: -1,
        minY: 3,
        maxX: 1,
        maxY: 4,
        center: { x: 0, y: 3.5 },
      },
    });
  });

  it('offsets repeated pastes without mutating source lines', () => {
    const source = [cpLine({ x: 1, y: 1 }, { x: 2, y: 2 })];
    const pasted = offsetCpLineSegmentsForPaste(source, 1);

    expect(pasted[0]).toMatchObject({
      a: { x: 17, y: -15 },
      b: { x: 18, y: -14 },
    });
    expect(source[0].a).toEqual({ x: 1, y: 1 });
  });

  it('translates selected lines by a model-space delta', () => {
    const translated = translateCpLineSegments([cpLine({ x: 1, y: 2 }, { x: 3, y: 4 })], {
      x: -2,
      y: 5,
    });

    expect(translated[0]).toMatchObject({
      a: { x: -1, y: 7 },
      b: { x: 1, y: 9 },
    });
  });

  it('includes selection bounds corners as move snap anchors', () => {
    const anchors = cpLineSelectionMoveAnchorPoints([
      cpLine({ x: 0, y: 10 }, { x: 6, y: 0 }),
      cpLine({ x: 6, y: 0 }, { x: 0, y: -10 }),
    ]);

    expect(anchors).toContainEqual({ x: 6, y: 10 });
    expect(anchors).toContainEqual({ x: 6, y: -10 });
    expect(anchors).toContainEqual({ x: 0, y: 10 });
    expect(anchors).toContainEqual({ x: 0, y: -10 });
  });

  it('uses an axis-aligned frame until an explicit transform angle is provided', () => {
    const source = [
      cpLine({ x: -2, y: -1 }, { x: 2, y: -1 }),
      cpLine({ x: 2, y: -1 }, { x: 2, y: 1 }),
      cpLine({ x: 2, y: 1 }, { x: -2, y: 1 }),
      cpLine({ x: -2, y: 1 }, { x: -2, y: -1 }),
    ];
    const rotated = transformCpLineSegments(source, { kind: 'rotate', angleDegrees: 30 });
    const defaultFrame = cpLineSelectionFrame(rotated);
    const transformFrame = cpLineSelectionFrame(rotated, 30);

    expect(defaultFrame?.angleDegrees).toBeCloseTo(0);
    expect(defaultFrame?.width).toBeGreaterThan(4);
    expect(transformFrame?.width).toBeCloseTo(4);
    expect(transformFrame?.height).toBeCloseTo(2);
    expect(transformFrame?.angleDegrees).toBeCloseTo(30);
  });

  it('scales selected lines in the selection frame', () => {
    const frame = cpLineSelectionFrame([cpLine({ x: -2, y: -1 }, { x: 2, y: 1 })]);
    expect(frame).not.toBeNull();

    const scaled = transformCpLineSegments([cpLine({ x: -2, y: -1 }, { x: 2, y: 1 })], {
      kind: 'scale',
      frame: frame!,
      anchor: { x: -frame!.width / 2, y: 0 },
      scaleX: 1.5,
      scaleY: 1,
    });

    expect(scaled[0].a.x).toBeCloseTo(-2);
    expect(scaled[0].a.y).toBeCloseTo(-1);
    expect(scaled[0].b.x).toBeCloseTo(4);
    expect(scaled[0].b.y).toBeCloseTo(1);
  });

  it('rotates and flips selected lines around their content center', () => {
    const lines = [cpLine({ x: 0, y: 0 }, { x: 2, y: 0 }, { color: 'Blue2' })];
    const rotated = transformCpLineSegments(lines, { kind: 'rotate', angleDegrees: 90 });
    const flipped = transformCpLineSegments(lines, {
      kind: 'flip-horizontal',
      swapMountainValley: true,
    });

    expect(rotated[0].a.x).toBeCloseTo(1);
    expect(rotated[0].a.y).toBeCloseTo(-1);
    expect(rotated[0].b.x).toBeCloseTo(1);
    expect(rotated[0].b.y).toBeCloseTo(1);
    expect(flipped[0]).toMatchObject({
      a: { x: 2, y: 0 },
      b: { x: 0, y: 0 },
      color: 'Red1',
    });
  });

  it('supports 22.5 degree rotation snapping helpers', () => {
    expect(snapRotationDegrees(23.2)).toBe(22.5);
    expect(snapRotationDegrees(34)).toBe(45);
    expect(rotationAngleFromCenter({ x: 1, y: 1 }, { x: 1, y: 2 })).toBeCloseTo(90);
  });

  it('returns null bounds for empty selections', () => {
    expect(cpLineSelectionBounds([])).toBeNull();
  });
});

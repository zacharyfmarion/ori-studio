/**
 * A spread figure on Edit's folded channel: it keeps the band it had, draws
 * its spread picture there at its own opacity, and draws none of its snapshot
 * — fills, lines, shadows or aux overlay — while the figures beside it draw as
 * they always have. Its box grows to its reach about the same pivot.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderPrimitive,
} from '../../engine/oristudioCpTypes';
import type { PaperScene } from '../../lib/paper/paperScene';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import { resetFoldedFigureSpreadReach, setFoldedFigureSpreadReach } from '../folded/foldedFigureSpreadReach';
import type { SpreadGeometry } from '../renderer/programs/spreadProgram';
import {
  applyFoldedPlacementToPoint,
  cpFoldedToScene,
  foldedFigureBox,
  foldedFigurePivot,
  type FoldedFigureAuxStrokes,
  type FoldedFigureSpreadPicture,
} from './cpFoldedToScene';

const square = (x0: number, y0: number, size: number): OristudioCpFoldedRenderPrimitive => ({
  sequence: 0,
  kind: 'fill_polygon',
  style: {
    paint: { kind: 'color', color: { red: 200, green: 100, blue: 50, alpha: 255 } },
    stroke: { kind: 'none' },
    antialias: 'default',
  },
  geometry: {
    kind: 'polygon',
    points: [
      { x: x0, y: y0 },
      { x: x0 + size, y: y0 },
      { x: x0 + size, y: y0 + size },
      { x: x0, y: y0 + size },
    ],
  },
});

function figure(id: string, placement: FoldedFigurePlacement): OristudioCpFoldedFigureEntry {
  return {
    id,
    title: id,
    handle: 3,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: null,
    startingFaceId: null,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: { outcome: 'Solved' } as OristudioCpFoldedFigureSnapshot,
    renderSnapshot: { schema_version: 1, fixture: null, pass: null, primitives: [square(0, 0, 100)] },
    placement,
    error: null,
  };
}

const GEOMETRY = { faces: [], visibility: { ranks: [], cyclic: false, above: [] } } as SpreadGeometry;
const AUX: FoldedFigureAuxStrokes = {
  segments: [{ a: { x: 0, y: 50 }, b: { x: 100, y: 50 } }] as FoldedFigureAuxStrokes['segments'],
  color: [0, 0, 1, 1],
  widthMul: 1,
};

afterEach(() => resetFoldedFigureSpreadReach());

describe('cpFoldedToScene with spread figures', () => {
  const plain = figure('plain', { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 });
  const spread = figure('spread', { offset: { x: 30, y: -10 }, scale: 2, rotation: 0.4 });
  const pivot = foldedFigurePivot(spread);
  const connected: FoldedFigureSpreadPicture = { kind: 'connected', geometry: GEOMETRY, xray: null, pivot };

  it('draws a connected picture in its band, at its opacity, in place of its snapshot and aux', () => {
    const opacity = (f: OristudioCpFoldedFigureEntry) => (f.id === 'spread' ? 0.45 : 1);
    const alone = cpFoldedToScene([plain], opacity, undefined, () => AUX);
    const both = cpFoldedToScene([plain, spread], opacity, undefined, () => AUX, undefined, (f) =>
      f.id === 'spread' ? connected : null
    );
    // The plain figure keeps the first of two bands; its own geometry is the same picture.
    expect(both.fills.count).toBe(alone.fills.count);
    expect(Array.from(both.fills.position)).toEqual(Array.from(alone.fills.position));
    expect(Math.max(...both.fills.depth!)).toBeLessThan(0.5);
    // The spread figure drew nothing on the channel: no fills, no aux line.
    expect(both.strokes.count).toBe(alone.strokes.count);
    expect(both.spreads).toEqual([
      {
        key: 'spread',
        geometry: GEOMETRY,
        layout: { band: { base: 0.5, span: 0.5 }, opacity: 0.45, xray: null },
        transform: {
          scale: 2,
          x: pivot.x + 30 - 2 * pivot.x,
          y: pivot.y - 10 - 2 * pivot.y,
        },
      },
    ]);
  });

  it('places a picture built turned about the pivot exactly where the snapshot lay', () => {
    const [layer] = cpFoldedToScene([spread], undefined, undefined, undefined, undefined, () => connected).spreads!;
    const { scale, x, y } = layer!.transform!;
    // A corner of the snapshot, built into the turned frame, then placed.
    const corner = cpModelToSvg({ x: 100, y: 0 });
    const cos = Math.cos(0.4);
    const sin = Math.sin(0.4);
    const turned = {
      x: pivot.x + cos * (corner.x - pivot.x) - sin * (corner.y - pivot.y),
      y: pivot.y + sin * (corner.x - pivot.x) + cos * (corner.y - pivot.y),
    };
    const flat = applyFoldedPlacementToPoint(corner, spread.placement, pivot);
    expect(scale * turned.x + x).toBeCloseTo(flat.x, 9);
    expect(scale * turned.y + y).toBeCloseTo(flat.y, 9);
  });

  it('inks an Affine or Depth scene on the channel, scaled and shifted only', () => {
    const scene: PaperScene = {
      sheet: 100,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      items: [
        {
          kind: 'face',
          face: 0,
          side: 'front',
          rings: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
            ],
          ],
          shade: 1,
          hidden: false,
        },
      ],
    };
    const painted = cpFoldedToScene([spread], undefined, undefined, () => AUX, undefined, () => ({
      kind: 'scene',
      scene,
      faceAlpha: 1,
      pivot,
    }));
    expect(painted.spreads).toBeUndefined();
    expect(painted.fills.count).toBe(3);
    // Each corner through scale 2 about the pivot, then the offset: no turn.
    const placedCorner = ([x, y]: [number, number]) => [pivot.x + 30 + 2 * (x - pivot.x), pivot.y - 10 + 2 * (y - pivot.y)];
    const expected = ([[0, 0], [10, 0], [10, 10]] as Array<[number, number]>).map(placedCorner);
    for (let v = 0; v < 3; v++) {
      const at = [painted.fills.position[2 * v]!, painted.fills.position[2 * v + 1]!];
      expect(expected.some(([x, y]) => Math.abs(x! - at[0]!) < 1e-3 && Math.abs(y! - at[1]!) < 1e-3)).toBe(true);
    }
    // No aux overlay: the scene carries its own lines.
    expect(painted.strokes.count).toBe(0);
  });

  it('leaves a channel with no spread figure exactly as it was', () => {
    const before = cpFoldedToScene([plain, spread]);
    const after = cpFoldedToScene([plain, spread], undefined, undefined, undefined, undefined, () => null);
    expect(after).toEqual(before);
    expect('spreads' in after).toBe(false);
  });
});

describe('foldedFigureBox with a spread', () => {
  const placed = figure('f', { offset: { x: 5, y: 7 }, scale: 1.5, rotation: 0.3 });

  it('grows to the spread’s reach about the same centre, once it is measured on this fold', () => {
    const flat = foldedFigureBox(placed)!;
    setFoldedFigureSpreadReach('f', { snapshot: placed.snapshot!, halfWidth: 400, halfHeight: 10 });
    const grown = foldedFigureBox(placed)!;
    expect(grown.center).toEqual(flat.center);
    expect(grown.rotation).toBe(flat.rotation);
    expect(grown.width).toBeCloseTo(800 * 1.5, 9);
    // Never smaller than the flat picture.
    expect(grown.height).toBe(flat.height);
  });

  it('answers for no other fold, and no other figure', () => {
    const flat = foldedFigureBox(placed)!;
    setFoldedFigureSpreadReach('f', {
      snapshot: { outcome: 'Solved' } as OristudioCpFoldedFigureSnapshot,
      halfWidth: 400,
      halfHeight: 400,
    });
    expect(foldedFigureBox(placed)).toEqual(flat);
    expect(foldedFigureBox({ ...placed, id: 'g' })).toEqual(flat);
  });
});

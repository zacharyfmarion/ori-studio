import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FillGeometry,
  FoldedGeometry,
  PointGeometry,
  StrokeGeometry,
  ViewTransform,
} from './types';
import type { CpRenderFrame } from './CpRenderer';

/**
 * The order every mocked program drew in, for the frame under test.
 *
 * Layer order is the one thing `reglRenderer.render` decides, and it is decided
 * by nothing more than the sequence of `draw` calls in one function — so it can
 * be reordered by an unrelated edit with no type error and no visible test
 * failure. This file is the pin.
 */
const drawLog: string[] = [];

/**
 * Which layer a geometry object belongs to. Programs are identified by the data
 * they were handed rather than by construction order, so moving a `create*`
 * call within the renderer cannot silently relabel a layer here.
 */
const layerOf = new Map<object, string>();

/** A program stub: remembers its last upload, and logs that layer when drawn. */
function mockProgram() {
  let data: object | null = null;
  return {
    setData: (geometry: object) => {
      data = geometry;
    },
    draw: () => {
      drawLog.push((data && layerOf.get(data)) ?? 'unlabelled');
    },
    dispose: () => {},
  };
}

vi.mock('regl', () => ({
  default: () => ({
    poll: () => {},
    clear: () => {},
    destroy: () => {},
    buffer: () => ({ destroy: () => {} }),
    texture: () => ({ destroy: () => {} }),
    on: () => ({ cancel: () => {} }),
  }),
}));

vi.mock('./programs/strokeProgram', () => ({ createStrokeProgram: () => mockProgram() }));
vi.mock('./programs/pointProgram', () => ({ createPointProgram: () => mockProgram() }));
vi.mock('./programs/fillProgram', () => ({ createFillProgram: () => mockProgram() }));
vi.mock('./programs/markerProgram', () => ({ createMarkerProgram: () => mockProgram() }));
vi.mock('./programs/wedgeProgram', () => ({ createWedgeProgram: () => mockProgram() }));
vi.mock('./programs/imageProgram', () => ({ createImageProgram: () => mockProgram() }));

const { createReglRenderer } = await import('./reglRenderer');

const VIEW: ViewTransform = { origin: [0, 0], ex: [1, 0], ey: [0, 1] };

const FRAME: CpRenderFrame = {
  clearColor: [0, 0, 0, 1],
  view: VIEW,
  userView: VIEW,
  strokeWidthPx: 1,
  userScalePx: 1,
  markerScalePx: 1,
  pointScalePx: 1,
  constantOutlinePx: 1,
  markerOutlinePx: 1,
  pointOutlinePx: 1,
  pointOpacity: 1,
};

/** A one-segment stroke buffer, tagged as `layer` for the draw log. */
function strokes(layer: string): StrokeGeometry {
  const geometry: StrokeGeometry = {
    a: new Float32Array([0, 0]),
    b: new Float32Array([1, 1]),
    color: new Float32Array([1, 1, 1, 1]),
    widthMul: new Float32Array([1]),
    count: 1,
  };
  layerOf.set(geometry, layer);
  return geometry;
}

/** A one-triangle fill buffer, tagged as `layer` for the draw log. */
function fills(layer: string): FillGeometry {
  const geometry: FillGeometry = {
    position: new Float32Array([0, 0, 1, 0, 0, 1]),
    color: new Float32Array(12).fill(1),
    count: 3,
  };
  layerOf.set(geometry, layer);
  return geometry;
}

/** A one-point buffer, tagged as `layer` for the draw log. */
function points(layer: string): PointGeometry {
  const geometry: PointGeometry = {
    center: new Float32Array([0, 0]),
    radius: new Float32Array([1]),
    screenSpace: new Float32Array([1]),
    fill: new Float32Array([1, 1, 1, 1]),
    stroke: new Float32Array([1, 1, 1, 1]),
    count: 1,
  };
  layerOf.set(geometry, layer);
  return geometry;
}

function folded(prefix: string): FoldedGeometry {
  return { fills: fills(`${prefix}-fills`), strokes: strokes(`${prefix}-strokes`) };
}

/** A renderer with every layer this file asserts on already uploaded. */
function renderScene() {
  const renderer = createReglRenderer(document.createElement('canvas'));
  renderer.resize({ width: 100, height: 100, dpr: 1 });
  renderer.setStrokes(strokes('creases'));
  renderer.setPoints(points('points'));
  renderer.setFolded(folded('folded'));
  renderer.setImportedForms(folded('imported'));
  renderer.render(FRAME);
  renderer.dispose();
}

beforeEach(() => {
  drawLog.length = 0;
  layerOf.clear();
});

describe('reglRenderer layer order', () => {
  /**
   * The regression this exists for: folded figures used to draw between the
   * creases and the point layer, so every crease point and derived vertex under
   * an opaque folded face punched through it — the figure read as translucent
   * paper rather than as an object resting on top of the pattern.
   */
  it('draws folded figures above the crease points and vertices', () => {
    renderScene();

    expect(drawLog.indexOf('folded-fills')).toBeGreaterThan(drawLog.indexOf('points'));
    expect(drawLog.indexOf('folded-strokes')).toBeGreaterThan(drawLog.indexOf('points'));
  });

  it('still draws folded figures above the creases they were folded from', () => {
    renderScene();

    expect(drawLog.indexOf('folded-fills')).toBeGreaterThan(drawLog.indexOf('creases'));
  });

  /**
   * Imported `.fold` forms share the folded figures' row layout and user-space
   * placement, so they belong in the same band — splitting them across the point
   * layer would flip which one wins where two overlap.
   */
  it('keeps imported .fold forms in the same band, above the generated figures', () => {
    renderScene();

    expect(drawLog).toEqual([
      'creases',
      'points',
      'folded-fills',
      'folded-strokes',
      'imported-fills',
      'imported-strokes',
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDGE_BOUNDARY_A, EDGE_CODE, type RenderSettings } from '@treemaker/origami-simulator';
import { drawFrame, EMPTY_HIGHLIGHTS, invalidateSimulatorSurface, pickDrawnFrame } from './canvas2dFrame';
import type { SimulatorRenderModel } from './renderModel';
import type { SimulatorPaint } from './simulatorPalette';
import type { SimulatorFrameView } from './useSimulatorRuntime';

/**
 * The software rasterizer against a mocked 2D context: jsdom has no canvas, so
 * the context is a recorder whose `getImageData` hands back a real pixel buffer
 * and whose `putImageData` keeps what the rasterizer wrote into it.
 */

interface RecordedContext {
  ctx: CanvasRenderingContext2D;
  /** The last buffer the rasterizer put back. */
  pixels: () => Uint8ClampedArray;
  /** Every `shadowBlur` the draw assigned, in order. */
  shadowBlurs: number[];
}

function recordingContext(width: number, height: number): RecordedContext {
  const shadowBlurs: number[] = [];
  let put: Uint8ClampedArray = new Uint8ClampedArray(0);
  const imageData = {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn(() => imageData),
    putImageData: vi.fn((data: ImageData) => {
      put = data.data;
    }),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => []),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D & { shadowBlur: number };
  Object.defineProperty(ctx, 'shadowBlur', {
    get: () => shadowBlurs[shadowBlurs.length - 1] ?? 0,
    set: (value: number) => {
      shadowBlurs.push(value);
    },
  });
  return { ctx, pixels: () => put, shadowBlurs };
}

/** One triangle in the plane the default view looks straight at, so its normal is the line of sight. */
const MODEL: SimulatorRenderModel = {
  vertexCount: 3,
  faceCount: 1,
  indices: new Uint32Array([0, 1, 2]),
  edgesVertices: [
    [0, 1],
    [1, 2],
    [2, 0],
  ],
  edgesAssignment: ['B', 'B', 'B'],
  edgeCodes: new Uint8Array([EDGE_CODE.border, EDGE_CODE.border, EDGE_CODE.border]),
  edgeBoundary: new Uint8Array([0, 0, 0]),
  facesEdges: [[0, 1, 2]],
  sheet: 2,
  faceGroups: new Int32Array([0]),
};

/**
 * The same triangle split down the middle by a vertex (3) on its base: two
 * faces, a mountain from the base to the apex, an aux crease alongside it and
 * the base's two halves. The mountain and the aux line both start on the
 * border, so their base ends retreat under erode.
 */
const SPLIT_MODEL: SimulatorRenderModel = {
  vertexCount: 4,
  faceCount: 2,
  indices: new Uint32Array([0, 3, 2, 3, 1, 2]),
  edgesVertices: [
    [0, 3],
    [3, 1],
    [1, 2],
    [2, 0],
    [3, 2],
  ],
  edgesAssignment: ['B', 'B', 'B', 'B', 'F'],
  edgeCodes: new Uint8Array([
    EDGE_CODE.border,
    EDGE_CODE.border,
    EDGE_CODE.border,
    EDGE_CODE.border,
    EDGE_CODE.aux,
  ]),
  edgeBoundary: new Uint8Array([0, 0, 0, 0, EDGE_BOUNDARY_A]),
  facesEdges: [
    [0, 4, 3],
    [1, 2, 4],
  ],
  sheet: 2,
  // Split by an aux crease, not a triangulation diagonal: two faces.
  faceGroups: new Int32Array([0, 1]),
};
// The split sheet's positions: vertex 3 at the middle of the base.
const SPLIT_SHEET = frameOf([-1, 0, -1, 1, 0, -1, -1, 0, 1, 0, 0, -1]);

/**
 * The split sheet with a line of each fold kind: the split is a mountain, the
 * hypotenuse a valley, and the base's halves and the left side the paper's
 * edge. The codes pick each line's width; the letters, kept in step with
 * them, pick its ink and dash.
 */
const KINDS_MODEL: SimulatorRenderModel = {
  ...SPLIT_MODEL,
  edgesAssignment: ['B', 'B', 'V', 'B', 'M'],
  edgeCodes: new Uint8Array([
    EDGE_CODE.border,
    EDGE_CODE.border,
    EDGE_CODE.valley,
    EDGE_CODE.border,
    EDGE_CODE.mountain,
  ]),
  edgeBoundary: new Uint8Array([0, 0, 0, 0, 0]),
};

function frameOf(positions: number[]): SimulatorFrameView {
  return {
    positions: new Float32Array(positions),
    bitmap: null,
    step: 0,
    stepsThisTick: 0,
    elapsedMs: 0,
    converged: true,
    foldPercent: 0,
    maxStrain: 0,
  };
}

// Yaw 0, pitch 0 maps world x to screen x and world z to screen y, so a sheet
// in the xz plane faces the viewer.
const FACING_SHEET = frameOf([-1, 0, -1, 1, 0, -1, -1, 0, 1]);
const VIEW = { yaw: 0, pitch: 0, zoom: 1 };

function paintWith(render: Partial<RenderSettings>): SimulatorPaint {
  return {
    render: {
      frontColor: [0.5, 0.5, 0.5],
      backColor: [0.5, 0.5, 0.5],
      mountainColor: [1, 0, 0],
      valleyColor: [0, 0, 1],
      borderColor: [0, 0, 0],
      lightDir: [0, 0, 1],
      background: [0, 0, 0],
      backgroundAlpha: 0,
      showFaces: true,
      showEdges: false,
      lighting: true,
      edgeWidthPx: 1,
      mountainWidthPx: 1,
      valleyWidthPx: 1,
      faceAlpha: 1,
      ...render,
    },
    chrome: {
      highlight: '#f0c674',
      highlightFaceRgb: [240, 198, 116],
      flat: '#aeb9bf',
      canvas: '#0c0f12',
    },
  };
}

let canvas: HTMLCanvasElement;
let recorded: RecordedContext;

beforeEach(() => {
  canvas = document.createElement('canvas');
  // jsdom reports no layout, so the surface takes its 720 px stand-in.
  recorded = recordingContext(720, 720);
  vi.spyOn(canvas, 'getContext').mockImplementation(
    () => recorded.ctx as unknown as ReturnType<HTMLCanvasElement['getContext']>
  );
});

afterEach(() => {
  invalidateSimulatorSurface(canvas);
  vi.restoreAllMocks();
});

/** The pixel at the frame's centre, where the triangle's centroid lands. */
function centrePixel(): [number, number, number] {
  const data = recorded.pixels();
  const offset = (360 * 720 + 360) * 4;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
}

describe('drawFrame', () => {
  it('shades a face from the light direction on the settings, with the shared band', () => {
    // Light along the line of sight: the face is square to it, so the band tops
    // out (0.74 + 0.3 + 0.04 = 1.08) and the grey lifts to 0.54.
    drawFrame(canvas, MODEL, FACING_SHEET, VIEW, paintWith({ lightDir: [0, 0, 1] }), EMPTY_HIGHLIGHTS);
    expect(centrePixel()).toEqual([138, 138, 138]);

    // Light in the screen plane: no diffuse term, only the ambient and the
    // facing lift (0.78), so the same grey darkens to 0.39.
    drawFrame(canvas, MODEL, FACING_SHEET, VIEW, paintWith({ lightDir: [1, 0, 0] }), EMPTY_HIGHLIGHTS);
    expect(centrePixel()).toEqual([99, 99, 99]);
  });

  it('multiplies rather than lifting toward white above 1', () => {
    // Re-pinned: this path used to blend a shade over 1 toward white, so a
    // bright face under the light washed out where the GPU saturated. The one
    // band is the GPU's: multiply and clamp per channel.
    drawFrame(
      canvas,
      MODEL,
      FACING_SHEET,
      VIEW,
      paintWith({ frontColor: [1, 0.5, 0], backColor: [1, 0.5, 0], lightDir: [0, 0, 1] }),
      EMPTY_HIGHLIGHTS
    );
    // 1 × 1.08 clamps to 1; 0.5 × 1.08 = 0.54; 0 stays 0 — a lift would have raised it.
    expect(centrePixel()).toEqual([255, 138, 0]);
  });

  it('leaves the paper unshaded with the light off', () => {
    drawFrame(canvas, MODEL, FACING_SHEET, VIEW, paintWith({ lighting: false }), EMPTY_HIGHLIGHTS);
    expect(centrePixel()).toEqual([128, 128, 128]);
  });

  it('tints a pinned face toward the highlight colour, by the mix the GPU pass uses', () => {
    const tint = paintWith({ lighting: false, highlightColor: [0, 0, 1], highlightMix: 0.5 });
    drawFrame(canvas, MODEL, FACING_SHEET, VIEW, tint, { ...EMPTY_HIGHLIGHTS, pinned: new Set([0]) });
    // Half way from the 128 grey to pure blue.
    expect(centrePixel()).toEqual([64, 64, 192]);

    drawFrame(canvas, MODEL, FACING_SHEET, VIEW, tint, EMPTY_HIGHLIGHTS);
    expect(centrePixel()).toEqual([128, 128, 128]);
  });

  it('casts no drop shadow', () => {
    // Re-pinned: a lit frame used to draw the silhouette a second time with a
    // canvas shadow behind the paper — a depth cue neither the GPU renderer nor
    // the export had, so the fallback and the export disagreed.
    drawFrame(canvas, MODEL, FACING_SHEET, VIEW, paintWith({ lighting: true }), EMPTY_HIGHLIGHTS);
    expect(recorded.shadowBlurs).toEqual([]);
    expect(recorded.ctx.save).not.toHaveBeenCalled();
  });
});

describe('drawFrame edges', () => {
  /** Every stroked segment as `[x1, y1, x2, y2]`, from the recorder's path calls. */
  function strokes(): [number, number, number, number][] {
    const moves = (recorded.ctx.moveTo as unknown as { mock: { calls: number[][] } }).mock.calls;
    const lines = (recorded.ctx.lineTo as unknown as { mock: { calls: number[][] } }).mock.calls;
    return moves.map((move, i) => [move[0]!, move[1]!, lines[i]![0]!, lines[i]![1]!]);
  }
  /** The stroke colours in the order they were set. */
  function strokeStyles(): string[] {
    return (recorded.ctx.stroke as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      () => ''
    );
  }
  const auxColor: [number, number, number] = [0, 1, 0];

  it('leaves the aux crease out by default and draws it in the aux pen when shown', () => {
    // A wireframe frame: faces off, so every edge goes through `drawAllEdges`.
    drawFrame(
      canvas,
      SPLIT_MODEL,
      SPLIT_SHEET,
      VIEW,
      paintWith({ showFaces: false, showEdges: true, auxColor }),
      EMPTY_HIGHLIGHTS
    );
    expect(strokes()).toHaveLength(4);

    recorded = recordingContext(720, 720);
    vi.spyOn(canvas, 'getContext').mockImplementation(
      () => recorded.ctx as unknown as ReturnType<HTMLCanvasElement['getContext']>
    );
    const styles: unknown[] = [];
    Object.defineProperty(recorded.ctx, 'strokeStyle', {
      set: (value: unknown) => styles.push(value),
      get: () => styles[styles.length - 1],
    });
    drawFrame(
      canvas,
      SPLIT_MODEL,
      SPLIT_SHEET,
      VIEW,
      paintWith({ showFaces: false, showEdges: true, showAux: true, auxColor }),
      EMPTY_HIGHLIGHTS
    );
    expect(strokes()).toHaveLength(5);
    expect(styles[4]).toBe('rgb(0 255 0)');
    expect(strokeStyles()).toHaveLength(5);
  });

  it('erodes a flagged end by the style’s fraction of the sheet at the frame’s scale', () => {
    // The aux crease runs from the base's midpoint (on the border, flagged) to
    // the apex (a corner, unflagged in this fixture). At erode 0.1 of a sheet
    // of 2 world units it retreats 0.2 world units along its length, which the
    // frame's scale turns into device px; the apex end stays put.
    const draw = (erode: number) => {
      recorded = recordingContext(720, 720);
      vi.spyOn(canvas, 'getContext').mockImplementation(
        () => recorded.ctx as unknown as ReturnType<HTMLCanvasElement['getContext']>
      );
      drawFrame(
        canvas,
        SPLIT_MODEL,
        SPLIT_SHEET,
        VIEW,
        paintWith({ showFaces: false, showEdges: true, showAux: true, auxColor, erode }),
        EMPTY_HIGHLIGHTS
      );
      return strokes()[4]!;
    };
    const whole = draw(0);
    const eroded = draw(0.1);
    // The crease is √5 world units long; its drawn length says what a unit is.
    const drawnLength = Math.hypot(whole[2] - whole[0], whole[3] - whole[1]);
    const pxPerUnit = drawnLength / Math.hypot(1, 2);
    const ux = (whole[2] - whole[0]) / drawnLength;
    const uy = (whole[3] - whole[1]) / drawnLength;
    expect(eroded[0]).toBeCloseTo(whole[0] + ux * 0.2 * pxPerUnit, 6);
    expect(eroded[1]).toBeCloseTo(whole[1] + uy * 0.2 * pxPerUnit, 6);
    expect(eroded[2]).toBeCloseTo(whole[2], 9);
    expect(eroded[3]).toBeCloseTo(whole[3], 9);
  });

  it('strokes each kind at its own pen’s width', () => {
    // A wireframe frame draws every edge at 0.7 of its pen, so the widths
    // come back scaled: the edge pen, the valley pen, the edge, the edge
    // again and the mountain pen, in the model's edge order.
    const widths: number[] = [];
    recorded.ctx.stroke = vi.fn(() => {
      widths.push(recorded.ctx.lineWidth);
    });
    drawFrame(
      canvas,
      KINDS_MODEL,
      SPLIT_SHEET,
      VIEW,
      paintWith({
        showFaces: false,
        showEdges: true,
        edgeWidthPx: 2,
        mountainWidthPx: 1,
        valleyWidthPx: 3,
      }),
      EMPTY_HIGHLIGHTS
    );
    expect(widths).toEqual([2, 2, 3, 2, 1].map((width) => expect.closeTo(width * 0.7, 9)));
  });

  it('shrinks every kind alike below an inline window’s reference edge, as the GPU pass does', () => {
    // The stand-in surface is 720 px square; a 1440 px reference halves every
    // pen at the default exponent, and a reference the frame reaches leaves
    // them whole.
    const widthsAt = (render: Partial<RenderSettings>) => {
      recorded = recordingContext(720, 720);
      vi.spyOn(canvas, 'getContext').mockImplementation(
        () => recorded.ctx as unknown as ReturnType<HTMLCanvasElement['getContext']>
      );
      const widths: number[] = [];
      recorded.ctx.stroke = vi.fn(() => {
        widths.push(recorded.ctx.lineWidth);
      });
      drawFrame(
        canvas,
        KINDS_MODEL,
        SPLIT_SHEET,
        VIEW,
        paintWith({
          showFaces: false,
          showEdges: true,
          edgeWidthPx: 4,
          mountainWidthPx: 2,
          valleyWidthPx: 6,
          ...render,
        }),
        EMPTY_HIGHLIGHTS
      );
      return widths;
    };
    // Wide enough that no halved pen meets the rasterizer's half-pixel floor.
    const pens = [4, 4, 6, 4, 2];
    expect(widthsAt({ creaseWidthReferenceEdge: 1440 })).toEqual(
      pens.map((width) => expect.closeTo(width * 0.7 * 0.5, 9))
    );
    expect(widthsAt({ creaseWidthReferenceEdge: 720 })).toEqual(
      pens.map((width) => expect.closeTo(width * 0.7, 9))
    );
  });

  it('strokes a shown aux crease at the aux pen’s width, or the edge’s without one', () => {
    const auxWidth = (render: Partial<RenderSettings>) => {
      recorded = recordingContext(720, 720);
      vi.spyOn(canvas, 'getContext').mockImplementation(
        () => recorded.ctx as unknown as ReturnType<HTMLCanvasElement['getContext']>
      );
      const widths: number[] = [];
      recorded.ctx.stroke = vi.fn(() => {
        widths.push(recorded.ctx.lineWidth);
      });
      drawFrame(
        canvas,
        SPLIT_MODEL,
        SPLIT_SHEET,
        VIEW,
        paintWith({ showFaces: false, showEdges: true, showAux: true, edgeWidthPx: 2, ...render }),
        EMPTY_HIGHLIGHTS
      );
      return widths[4];
    };
    expect(auxWidth({ auxWidthPx: 4 })).toBeCloseTo(4 * 0.7, 9);
    expect(auxWidth({})).toBeCloseTo(2 * 0.7, 9);
  });

  it('drops a crease the erosion would invert', () => {
    drawFrame(
      canvas,
      SPLIT_MODEL,
      SPLIT_SHEET,
      VIEW,
      paintWith({ showFaces: false, showEdges: true, showAux: true, auxColor, erode: 0.6 }),
      EMPTY_HIGHLIGHTS
    );
    // The aux line is √5 ≈ 2.24 units long and the pull is 1.2, past its
    // midpoint; the four borders never erode.
    expect(strokes()).toHaveLength(4);
  });
});

describe('pickDrawnFrame', () => {
  const at = (x: number, y: number) => ({
    region: { kind: 'point' as const, x, y },
    // The surface's 720 px stand-in, one CSS pixel per device pixel.
    cssWidth: 720,
    cssHeight: 720,
    depth: 'all-layers' as const,
  });

  it('has nothing to answer before a frame is drawn', () => {
    expect(pickDrawnFrame(canvas, MODEL, at(360, 360))).toBeNull();
  });

  it('answers for the frame it drew: the face at the centre, nothing in the corner', () => {
    drawFrame(canvas, MODEL, FACING_SHEET, VIEW, paintWith({}), EMPTY_HIGHLIGHTS);
    // The framing puts the triangle's centroid at the centre of the frame.
    expect(pickDrawnFrame(canvas, MODEL, at(360, 360))).toEqual([0]);
    expect(pickDrawnFrame(canvas, MODEL, at(715, 5))).toEqual([]);
  });
});

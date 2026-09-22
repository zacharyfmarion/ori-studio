import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderSettings } from '@treemaker/origami-simulator';
import { drawFrame, EMPTY_HIGHLIGHTS, invalidateSimulatorSurface } from './canvas2dFrame';
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
  facesEdges: [[0, 1, 2]],
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
      creaseWidthPx: 1,
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

  it('casts no drop shadow', () => {
    // Re-pinned: a lit frame used to draw the silhouette a second time with a
    // canvas shadow behind the paper — a depth cue neither the GPU renderer nor
    // the export had, so the fallback and the export disagreed.
    drawFrame(canvas, MODEL, FACING_SHEET, VIEW, paintWith({ lighting: true }), EMPTY_HIGHLIGHTS);
    expect(recorded.shadowBlurs).toEqual([]);
    expect(recorded.ctx.save).not.toHaveBeenCalled();
  });
});

import type createREGL from 'regl';
import type { WedgeGeometry, ViewTransform, Viewport } from '../types';
import { disposeOnce } from './disposeOnce';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;

/**
 * Instanced big-little-big sector wedges. Each instance is a filled triangle: a
 * vertex (fan apex, model coords) plus two rim points placed a fixed *screen* radius
 * along two crease directions. The rim radius scales by `u_scalePx` (markerScalePx),
 * so the wedges track the other diagnostic markers as the camera zooms rather than
 * being pinned to the model — matching Ori Studio's zoom-aware diagnostic markers.
 */
const VERT = `
precision highp float;
attribute float aCorner;    // 0 = apex, 1 = rim0, 2 = rim1
attribute vec2 aCenter;     // model coords
attribute vec2 aDir0;       // model direction to rim 0
attribute vec2 aDir1;       // model direction to rim 1
attribute float aRadiusPx;  // rim radius, CSS px
attribute vec4 aColor;
uniform vec2 u_origin;
uniform vec2 u_ex;
uniform vec2 u_ey;
uniform vec2 u_viewport;
uniform float u_scalePx;    // CSS px -> device px, with the marker zoom boost
varying vec4 vColor;
void main() {
  vec2 centerDev = u_origin + aCenter.x * u_ex + aCenter.y * u_ey;
  vec2 offset = vec2(0.0);
  if (aCorner > 0.5) {
    vec2 dir = aCorner > 1.5 ? aDir1 : aDir0;
    // Rotate/flip the model direction through the view basis, then place the rim at a
    // fixed device distance so the wedge angle stays true and its size is screen-based.
    vec2 devDir = dir.x * u_ex + dir.y * u_ey;
    float len = length(devDir);
    if (len > 1e-6) offset = (devDir / len) * (aRadiusPx * u_scalePx);
  }
  vec2 posDev = centerDev + offset;
  vec2 clip = vec2(posDev.x / u_viewport.x * 2.0 - 1.0, 1.0 - posDev.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aColor;
}`;

const FILL_FRAG = `
precision highp float;
varying vec4 vColor;
void main() { gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

// Outline pass: the sector's tone at a fixed strong alpha, so every sector edge
// reads (the SVG stroked them all); the per-sector fill alpha is ignored here.
const OUTLINE_FRAG = `
precision highp float;
varying vec4 vColor;
const float A = 0.9;
void main() { gl_FragColor = vec4(vColor.rgb * A, A); }`;

// Three fan corners: apex + the two rim points.
const CORNERS = new Float32Array([0, 1, 2]);

export interface WedgeDrawProps {
  view: ViewTransform;
  viewport: Viewport;
  /** CSS px -> device px, including the marker zoom boost (markerScalePx). */
  scalePx: number;
}

export interface WedgeProgram {
  setData(geometry: WedgeGeometry): void;
  draw(props: WedgeDrawProps): void;
  dispose(): void;
}

type Vec2 = [number, number];

interface WedgeDrawParams {
  originArr: Vec2;
  exArr: Vec2;
  eyArr: Vec2;
  viewportArr: Vec2;
  scalePx: number;
  centerBuf: Buffer;
  dir0Buf: Buffer;
  dir1Buf: Buffer;
  radiusBuf: Buffer;
  colorBuf: Buffer;
  instanceCount: number;
}

interface WedgeUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
  u_scalePx: number;
}

interface WedgeAttributes {
  aCorner: unknown;
  aCenter: unknown;
  aDir0: unknown;
  aDir1: unknown;
  aRadiusPx: unknown;
  aColor: unknown;
}

export function createWedgeProgram(regl: Regl): WedgeProgram {
  const corners = regl.buffer(CORNERS);
  let centerBuf: Buffer | null = null;
  let dir0Buf: Buffer | null = null;
  let dir1Buf: Buffer | null = null;
  let radiusBuf: Buffer | null = null;
  let colorBuf: Buffer | null = null;
  let count = 0;

  const shared = {
    vert: VERT,
    attributes: {
      aCorner: corners,
      aCenter: { buffer: (_c: unknown, props: WedgeDrawParams) => props.centerBuf, divisor: 1 },
      aDir0: { buffer: (_c: unknown, props: WedgeDrawParams) => props.dir0Buf, divisor: 1 },
      aDir1: { buffer: (_c: unknown, props: WedgeDrawParams) => props.dir1Buf, divisor: 1 },
      aRadiusPx: { buffer: (_c: unknown, props: WedgeDrawParams) => props.radiusBuf, divisor: 1 },
      aColor: { buffer: (_c: unknown, props: WedgeDrawParams) => props.colorBuf, divisor: 1 },
    },
    uniforms: {
      u_origin: (_ctx: unknown, props: WedgeDrawParams) => props.originArr,
      u_ex: (_ctx: unknown, props: WedgeDrawParams) => props.exArr,
      u_ey: (_ctx: unknown, props: WedgeDrawParams) => props.eyArr,
      u_viewport: (_ctx: unknown, props: WedgeDrawParams) => props.viewportArr,
      u_scalePx: (_ctx: unknown, props: WedgeDrawParams) => props.scalePx,
    },
    blend: {
      enable: true,
      func: {
        srcRGB: 1,
        srcAlpha: 1,
        dstRGB: 'one minus src alpha',
        dstAlpha: 'one minus src alpha',
      },
    },
    depth: { enable: false },
    count: 3,
    instances: (_ctx: unknown, props: WedgeDrawParams) => props.instanceCount,
  } as const;

  const drawFill = regl<WedgeUniforms, WedgeAttributes, WedgeDrawParams>({
    ...shared,
    frag: FILL_FRAG,
  });
  // Closed triangle outline (apex -> rim0 -> rim1 -> apex) so each sector edge reads.
  const drawOutline = regl<WedgeUniforms, WedgeAttributes, WedgeDrawParams>({
    ...shared,
    frag: OUTLINE_FRAG,
    primitive: 'line loop',
  });

  return {
    setData(geometry) {
      count = geometry.count;
      centerBuf?.destroy();
      dir0Buf?.destroy();
      dir1Buf?.destroy();
      radiusBuf?.destroy();
      colorBuf?.destroy();
      centerBuf = regl.buffer(geometry.center);
      dir0Buf = regl.buffer(geometry.dir0);
      dir1Buf = regl.buffer(geometry.dir1);
      radiusBuf = regl.buffer(geometry.radiusPx);
      colorBuf = regl.buffer(geometry.color);
    },
    draw({ view, viewport, scalePx }) {
      if (count === 0 || !centerBuf || !dir0Buf || !dir1Buf || !radiusBuf || !colorBuf) return;
      const params: WedgeDrawParams = {
        originArr: [view.origin[0], view.origin[1]],
        exArr: [view.ex[0], view.ex[1]],
        eyArr: [view.ey[0], view.ey[1]],
        viewportArr: [viewport.width, viewport.height],
        scalePx,
        centerBuf,
        dir0Buf,
        dir1Buf,
        radiusBuf,
        colorBuf,
        instanceCount: count,
      };
      drawFill(params);
      drawOutline(params);
    },
    dispose: disposeOnce(() => {
      corners.destroy();
      centerBuf?.destroy();
      dir0Buf?.destroy();
      dir1Buf?.destroy();
      radiusBuf?.destroy();
      colorBuf?.destroy();
    }),
  };
}

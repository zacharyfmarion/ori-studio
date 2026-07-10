import type createREGL from 'regl';
import type { StrokeGeometry, ViewTransform, Viewport } from '../types';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;

/**
 * Instanced stroke program: draws each segment as a screen-space-width quad.
 * Positions are transformed model -> device via the {@link ViewTransform} basis,
 * then the quad is extruded along the segment normal by a device-pixel width, so
 * line width is controlled explicitly (matching the SVG's rendered stroke).
 */
const VERT = `
precision highp float;
attribute vec2 corner;   // (t in {0,1} along segment, side in {-0.5,0.5})
attribute vec2 aA;       // segment start, model coords
attribute vec2 aB;       // segment end, model coords
attribute vec4 aColor;
attribute float aWidthMul; // per-segment width multiplier
uniform vec2 u_origin;   // device px of model (0,0)
uniform vec2 u_ex;       // device delta per +1 model x
uniform vec2 u_ey;       // device delta per +1 model y
uniform vec2 u_viewport; // device px
uniform float u_widthPx; // base stroke width, device px
varying vec4 vColor;
vec2 toDevice(vec2 m) { return u_origin + m.x * u_ex + m.y * u_ey; }
void main() {
  vec2 sA = toDevice(aA);
  vec2 sB = toDevice(aB);
  vec2 d = sB - sA;
  float len = length(d);
  d = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-d.y, d.x);
  float widthPx = max(1.0, u_widthPx * aWidthMul);
  vec2 pos = mix(sA, sB, corner.x) + nrm * widthPx * corner.y;
  // device (y-down) -> clip
  vec2 clip = vec2(pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - pos.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aColor;
}`;

const FRAG = `
precision highp float;
varying vec4 vColor;
void main() { gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

// Unit quad (two triangles) parameterised as (t, side).
const QUAD = new Float32Array([0, -0.5, 1, -0.5, 1, 0.5, 0, -0.5, 1, 0.5, 0, 0.5]);

export interface StrokeDrawProps {
  view: ViewTransform;
  viewport: Viewport;
  widthPx: number;
}

export interface StrokeProgram {
  /** Upload (or replace) the segment geometry. */
  setData(geometry: StrokeGeometry): void;
  /** Draw the current geometry. No-op until {@link setData} has been called. */
  draw(props: StrokeDrawProps): void;
  dispose(): void;
}

type Vec2 = [number, number];

/**
 * Per-draw props. The geometry buffers are passed as props (not captured in the
 * command config) so that recreating them in {@link StrokeProgram.setData} takes
 * effect immediately — capturing a buffer in the config snapshots its size at
 * command-build time, which silently breaks updates.
 */
interface StrokeDrawParams {
  originArr: Vec2;
  exArr: Vec2;
  eyArr: Vec2;
  viewportArr: Vec2;
  widthPx: number;
  aBuf: Buffer;
  bBuf: Buffer;
  colorBuf: Buffer;
  widthMulBuf: Buffer;
  instanceCount: number;
}

/** Uniform key shapes for the regl command generic. */
interface StrokeUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
  u_widthPx: number;
}

/** Attribute key shapes; values are regl attribute configs (kept permissive). */
interface StrokeAttributes {
  corner: unknown;
  aA: unknown;
  aB: unknown;
  aColor: unknown;
  aWidthMul: unknown;
}

export function createStrokeProgram(regl: Regl): StrokeProgram {
  const quad = regl.buffer(QUAD);
  let aBuf: Buffer | null = null;
  let bBuf: Buffer | null = null;
  let colorBuf: Buffer | null = null;
  let widthMulBuf: Buffer | null = null;
  let count = 0;

  const draw = regl<StrokeUniforms, StrokeAttributes, StrokeDrawParams>({
    vert: VERT,
    frag: FRAG,
    attributes: {
      corner: quad,
      aA: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.aBuf, divisor: 1 },
      aB: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.bBuf, divisor: 1 },
      aColor: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.colorBuf, divisor: 1 },
      aWidthMul: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.widthMulBuf, divisor: 1 },
    },
    uniforms: {
      u_origin: (_ctx, props) => props.originArr,
      u_ex: (_ctx, props) => props.exArr,
      u_ey: (_ctx, props) => props.eyArr,
      u_viewport: (_ctx, props) => props.viewportArr,
      u_widthPx: (_ctx, props) => props.widthPx,
    },
    // Premultiplied-alpha blend: a no-op for opaque creases (alpha 1), and lets
    // semi-transparent strokes (e.g. grid lines) composite over the background.
    blend: {
      enable: true,
      func: { srcRGB: 1, srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' },
    },
    depth: { enable: false },
    count: 6,
    instances: (_ctx, props) => props.instanceCount,
  });

  return {
    setData(geometry) {
      count = geometry.count;
      aBuf?.destroy();
      bBuf?.destroy();
      colorBuf?.destroy();
      widthMulBuf?.destroy();
      aBuf = regl.buffer(geometry.a);
      bBuf = regl.buffer(geometry.b);
      colorBuf = regl.buffer(geometry.color);
      widthMulBuf = regl.buffer(geometry.widthMul);
    },
    draw({ view, viewport, widthPx }) {
      if (count === 0 || !aBuf || !bBuf || !colorBuf || !widthMulBuf) return;
      draw({
        originArr: [view.origin[0], view.origin[1]],
        exArr: [view.ex[0], view.ex[1]],
        eyArr: [view.ey[0], view.ey[1]],
        viewportArr: [viewport.width, viewport.height],
        widthPx: Math.max(1, widthPx),
        aBuf,
        bBuf,
        colorBuf,
        widthMulBuf,
        instanceCount: count,
      });
    },
    dispose() {
      quad.destroy();
      aBuf?.destroy();
      bBuf?.destroy();
      colorBuf?.destroy();
      widthMulBuf?.destroy();
    },
  };
}

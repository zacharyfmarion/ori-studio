import type createREGL from 'regl';
import type { PointGeometry, ViewTransform, Viewport } from '../types';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;

/**
 * Instanced point program: draws each crease point / vertex as a filled circle
 * with a thin outline. A unit quad is expanded to the point's device radius; the
 * fragment shader renders the disc (antialiased) and an outline ring.
 *
 * Radii arrive in SVG user units and are scaled to device px by `u_userScalePx`
 * so points grow with zoom, matching the SVG. The outline width is constant
 * device px (`u_outlinePx`), matching the SVG's non-scaling stroke.
 */
const VERT = `
precision highp float;
attribute vec2 corner;   // unit quad in [-1,1]^2
attribute vec2 aCenter;  // model coords
attribute float aRadius; // user units
attribute vec4 aFill;
attribute vec4 aStroke;
uniform vec2 u_origin;
uniform vec2 u_ex;
uniform vec2 u_ey;
uniform vec2 u_viewport;
uniform float u_userScalePx; // user units -> device px
uniform float u_outlinePx;   // outline width, device px
varying vec2 vLocal;
varying float vRadiusPx;
varying float vOuterPx;
varying vec4 vFill;
varying vec4 vStroke;
void main() {
  vec2 centerDev = u_origin + aCenter.x * u_ex + aCenter.y * u_ey;
  float radiusPx = max(1.0, aRadius * u_userScalePx);
  // Outline straddles the fill edge (like the SVG's centred stroke), so expand
  // the quad by half the outline width to leave room for the outer half.
  float outerPx = radiusPx + u_outlinePx * 0.5;
  vec2 posDev = centerDev + corner * outerPx;
  vec2 clip = vec2(posDev.x / u_viewport.x * 2.0 - 1.0, 1.0 - posDev.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vLocal = corner;
  vRadiusPx = radiusPx;
  vOuterPx = outerPx;
  vFill = aFill;
  vStroke = aStroke;
}`;

const FRAG = `
precision highp float;
varying vec2 vLocal;
varying float vRadiusPx;
varying float vOuterPx;
varying vec4 vFill;
varying vec4 vStroke;
uniform float u_outlinePx;
void main() {
  float d = length(vLocal) * vOuterPx; // distance from center, device px
  if (d > vOuterPx) discard;
  float aa = 1.0;
  float halfOutline = u_outlinePx * 0.5;
  // Stroke band straddles the fill radius; fill everywhere inside it.
  float strokeMask = u_outlinePx > 0.0
    ? 1.0 - smoothstep(halfOutline - aa, halfOutline + aa, abs(d - vRadiusPx))
    : 0.0;
  vec4 color = mix(vFill, vStroke, strokeMask);
  float outerAlpha = 1.0 - smoothstep(vOuterPx - aa, vOuterPx, d);
  float alpha = color.a * outerAlpha;
  gl_FragColor = vec4(color.rgb * alpha, alpha);
}`;

const QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

export interface PointDrawProps {
  view: ViewTransform;
  viewport: Viewport;
  userScalePx: number;
  outlinePx: number;
}

export interface PointProgram {
  setData(geometry: PointGeometry): void;
  draw(props: PointDrawProps): void;
  dispose(): void;
}

type Vec2 = [number, number];

interface PointDrawParams {
  originArr: Vec2;
  exArr: Vec2;
  eyArr: Vec2;
  viewportArr: Vec2;
  userScalePx: number;
  outlinePx: number;
  centerBuf: Buffer;
  radiusBuf: Buffer;
  fillBuf: Buffer;
  strokeBuf: Buffer;
  instanceCount: number;
}

interface PointUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
  u_userScalePx: number;
  u_outlinePx: number;
}

interface PointAttributes {
  corner: unknown;
  aCenter: unknown;
  aRadius: unknown;
  aFill: unknown;
  aStroke: unknown;
}

export function createPointProgram(regl: Regl): PointProgram {
  const quad = regl.buffer(QUAD);
  let centerBuf: Buffer | null = null;
  let radiusBuf: Buffer | null = null;
  let fillBuf: Buffer | null = null;
  let strokeBuf: Buffer | null = null;
  let count = 0;

  const draw = regl<PointUniforms, PointAttributes, PointDrawParams>({
    vert: VERT,
    frag: FRAG,
    attributes: {
      corner: quad,
      aCenter: { buffer: (_ctx: unknown, props: PointDrawParams) => props.centerBuf, divisor: 1 },
      aRadius: { buffer: (_ctx: unknown, props: PointDrawParams) => props.radiusBuf, divisor: 1 },
      aFill: { buffer: (_ctx: unknown, props: PointDrawParams) => props.fillBuf, divisor: 1 },
      aStroke: { buffer: (_ctx: unknown, props: PointDrawParams) => props.strokeBuf, divisor: 1 },
    },
    uniforms: {
      u_origin: (_ctx, props) => props.originArr,
      u_ex: (_ctx, props) => props.exArr,
      u_ey: (_ctx, props) => props.eyArr,
      u_viewport: (_ctx, props) => props.viewportArr,
      u_userScalePx: (_ctx, props) => props.userScalePx,
      u_outlinePx: (_ctx, props) => props.outlinePx,
    },
    // Points overlap crease lines and each other; blend for antialiased edges.
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
      centerBuf?.destroy();
      radiusBuf?.destroy();
      fillBuf?.destroy();
      strokeBuf?.destroy();
      centerBuf = regl.buffer(geometry.center);
      radiusBuf = regl.buffer(geometry.radius);
      fillBuf = regl.buffer(geometry.fill);
      strokeBuf = regl.buffer(geometry.stroke);
    },
    draw({ view, viewport, userScalePx, outlinePx }) {
      if (count === 0 || !centerBuf || !radiusBuf || !fillBuf || !strokeBuf) return;
      draw({
        originArr: [view.origin[0], view.origin[1]],
        exArr: [view.ex[0], view.ex[1]],
        eyArr: [view.ey[0], view.ey[1]],
        viewportArr: [viewport.width, viewport.height],
        userScalePx,
        outlinePx,
        centerBuf,
        radiusBuf,
        fillBuf,
        strokeBuf,
        instanceCount: count,
      });
    },
    dispose() {
      quad.destroy();
      centerBuf?.destroy();
      radiusBuf?.destroy();
      fillBuf?.destroy();
      strokeBuf?.destroy();
    },
  };
}

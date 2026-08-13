import type createREGL from 'regl';
import type { PointGeometry, ViewTransform, Viewport } from '../types';
import { disposeOnce } from './disposeOnce';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;

/**
 * Instanced point program: draws each crease point / vertex as a filled circle
 * with a thin outline. A unit quad is expanded to the point's device radius; the
 * fragment shader renders the disc (antialiased) and an outline ring.
 *
 * Each instance sizes one of two ways (`aScreenSpace`): markers (crease points
 * and derived vertices) are sized in screen space — radius in CSS px scaled by
 * `u_markerScalePx` so they stay crisp at any zoom, like Oriedita — while circles
 * are real geometry, radius in SVG user units scaled by `u_userScalePx` (grows
 * with zoom). Each carries its own outline width, since the marker outline scales
 * with its marker while the circle outline stays a constant-width hairline.
 *
 * Instances shrink the whole way down rather than pinning at a floor, and the
 * caller supplies a per-layer opacity so a layer can be faded out entirely on a
 * zoomed-out view. That opacity is computed from the camera's zoom ratio rather
 * than from a pixel size, so the behaviour is identical on every display
 * density — see the vertex-visibility constants in the canvas component.
 *
 * The only pixel-keyed rule left here is an anti-flicker guard: a disc under
 * half a device pixel cannot land reliably on a sample, so it is dropped.
 */
const VERT = `
precision highp float;
/** Anti-flicker guard: a disc below this cannot sample reliably, so it goes. */
const float MIN_RADIUS_PX = 0.25;
const float MIN_RADIUS_FULL_PX = 0.75;
attribute vec2 corner;      // unit quad in [-1,1]^2
attribute vec2 aCenter;     // model coords
attribute float aRadius;    // CSS px (markers) or user units (circles)
attribute float aScreenSpace; // 1 = screen-space size, 0 = scales with zoom
attribute vec4 aFill;
attribute vec4 aStroke;
uniform vec2 u_origin;
uniform vec2 u_ex;
uniform vec2 u_ey;
uniform vec2 u_viewport;
uniform float u_userScalePx;     // user units -> device px (zoom)
uniform float u_markerScalePx;   // CSS px -> device px (dpr x marker shrink)
uniform float u_userOutlinePx;   // circle outline width, device px
uniform float u_markerOutlinePx; // marker outline width, device px
uniform float u_userOpacity;     // layer opacity for user-space instances
uniform float u_markerOpacity;   // layer opacity for screen-space instances
varying vec2 vLocal;        // device px offset from the centre
varying float vRadiusPx;
varying float vOuterPx;
varying float vOutlinePx;
varying float vFade;
varying vec4 vFill;
varying vec4 vStroke;
void main() {
  vec2 centerDev = u_origin + aCenter.x * u_ex + aCenter.y * u_ey;
  bool marker = aScreenSpace > 0.5;
  float scale = marker ? u_markerScalePx : u_userScalePx;
  float radiusPx = aRadius * scale;
  float outlinePx = marker ? u_markerOutlinePx : u_userOutlinePx;
  float opacity = marker ? u_markerOpacity : u_userOpacity;
  vFade = opacity * smoothstep(MIN_RADIUS_PX, MIN_RADIUS_FULL_PX, radiusPx);
  // Outline straddles the fill edge (like the SVG's centred stroke), so expand
  // the quad by half the outline width to leave room for the outer half.
  float outerPx = radiusPx + outlinePx * 0.5;
  // Give the quad a pixel of slack so a sub-pixel disc still lands on a sample;
  // the fragment stage clips back to the true radius. A fully faded instance
  // collapses to a degenerate quad so the GPU discards it outright.
  float quadPx = vFade > 0.0 ? max(outerPx, 1.0) : 0.0;
  vLocal = corner * quadPx;
  vRadiusPx = radiusPx;
  vOuterPx = outerPx;
  vOutlinePx = outlinePx;
  vFill = aFill;
  vStroke = aStroke;
  vec2 posDev = centerDev + vLocal;
  vec2 clip = vec2(posDev.x / u_viewport.x * 2.0 - 1.0, 1.0 - posDev.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vLocal;
varying float vRadiusPx;
varying float vOuterPx;
varying float vOutlinePx;
varying float vFade;
varying vec4 vFill;
varying vec4 vStroke;
void main() {
  float d = length(vLocal); // distance from center, device px
  if (d > vOuterPx) discard;
  // Never smooth over more than the disc itself, or a one-pixel dot is eaten
  // whole by its own antialiasing band.
  float aa = min(1.0, vOuterPx);
  float halfOutline = vOutlinePx * 0.5;
  // Stroke band straddles the fill radius; fill everywhere inside it.
  float strokeMask = vOutlinePx > 0.0
    ? 1.0 - smoothstep(halfOutline - aa, halfOutline + aa, abs(d - vRadiusPx))
    : 0.0;
  vec4 color = mix(vFill, vStroke, strokeMask);
  float outerAlpha = 1.0 - smoothstep(vOuterPx - aa, vOuterPx, d);
  float alpha = color.a * outerAlpha * vFade;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(color.rgb * alpha, alpha);
}`;

const QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

export interface PointDrawProps {
  view: ViewTransform;
  viewport: Viewport;
  userScalePx: number;
  markerScalePx: number;
  /** Circle (user-space) outline width in device px — a constant hairline. */
  userOutlinePx: number;
  /** Marker (screen-space) outline width in device px. */
  markerOutlinePx: number;
  /** Layer opacity applied to user-space instances (circles). */
  userOpacity: number;
  /** Layer opacity applied to screen-space instances (points, vertices). */
  markerOpacity: number;
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
  markerScalePx: number;
  userOutlinePx: number;
  markerOutlinePx: number;
  userOpacity: number;
  markerOpacity: number;
  centerBuf: Buffer;
  radiusBuf: Buffer;
  screenSpaceBuf: Buffer;
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
  u_markerScalePx: number;
  u_userOutlinePx: number;
  u_markerOutlinePx: number;
  u_userOpacity: number;
  u_markerOpacity: number;
}

interface PointAttributes {
  corner: unknown;
  aCenter: unknown;
  aRadius: unknown;
  aScreenSpace: unknown;
  aFill: unknown;
  aStroke: unknown;
}

export function createPointProgram(regl: Regl): PointProgram {
  const quad = regl.buffer(QUAD);
  let centerBuf: Buffer | null = null;
  let radiusBuf: Buffer | null = null;
  let screenSpaceBuf: Buffer | null = null;
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
      aScreenSpace: {
        buffer: (_ctx: unknown, props: PointDrawParams) => props.screenSpaceBuf,
        divisor: 1,
      },
      aFill: { buffer: (_ctx: unknown, props: PointDrawParams) => props.fillBuf, divisor: 1 },
      aStroke: { buffer: (_ctx: unknown, props: PointDrawParams) => props.strokeBuf, divisor: 1 },
    },
    uniforms: {
      u_origin: (_ctx, props) => props.originArr,
      u_ex: (_ctx, props) => props.exArr,
      u_ey: (_ctx, props) => props.eyArr,
      u_viewport: (_ctx, props) => props.viewportArr,
      u_userScalePx: (_ctx, props) => props.userScalePx,
      u_markerScalePx: (_ctx, props) => props.markerScalePx,
      u_userOutlinePx: (_ctx, props) => props.userOutlinePx,
      u_markerOutlinePx: (_ctx, props) => props.markerOutlinePx,
      u_userOpacity: (_ctx, props) => props.userOpacity,
      u_markerOpacity: (_ctx, props) => props.markerOpacity,
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
      screenSpaceBuf?.destroy();
      fillBuf?.destroy();
      strokeBuf?.destroy();
      centerBuf = regl.buffer(geometry.center);
      radiusBuf = regl.buffer(geometry.radius);
      screenSpaceBuf = regl.buffer(geometry.screenSpace);
      fillBuf = regl.buffer(geometry.fill);
      strokeBuf = regl.buffer(geometry.stroke);
    },
    draw({
      view,
      viewport,
      userScalePx,
      markerScalePx,
      userOutlinePx,
      markerOutlinePx,
      userOpacity,
      markerOpacity,
    }) {
      if (
        count === 0 ||
        !centerBuf ||
        !radiusBuf ||
        !screenSpaceBuf ||
        !fillBuf ||
        !strokeBuf
      ) {
        return;
      }
      draw({
        originArr: [view.origin[0], view.origin[1]],
        exArr: [view.ex[0], view.ex[1]],
        eyArr: [view.ey[0], view.ey[1]],
        viewportArr: [viewport.width, viewport.height],
        userScalePx,
        markerScalePx,
        userOutlinePx,
        markerOutlinePx,
        userOpacity,
        markerOpacity,
        centerBuf,
        radiusBuf,
        screenSpaceBuf,
        fillBuf,
        strokeBuf,
        instanceCount: count,
      });
    },
    dispose: disposeOnce(() => {
      quad.destroy();
      centerBuf?.destroy();
      radiusBuf?.destroy();
      screenSpaceBuf?.destroy();
      fillBuf?.destroy();
      strokeBuf?.destroy();
    }),
  };
}

import type createREGL from 'regl';
import type { MarkerGeometry, ViewTransform, Viewport } from '../types';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;

/**
 * Instanced screen-space marker program: draws diagnostic markers as fixed-pixel
 * shapes anchored at model points. A unit quad is projected at the anchor and
 * expanded to the marker's device size; the fragment shader evaluates a per-shape
 * signed-distance field (disc / ring / triangle / square / pentagon / cross) to
 * fill the interior and straddle-stroke the border, antialiased. Screen-constant
 * like Oriedita's diagnostic markers — size does not change with zoom.
 */
const VERT = `
precision highp float;
attribute vec2 corner;      // unit quad in [-1,1]^2
attribute vec2 aCenter;     // model coords
attribute float aSizePx;    // half-extent, CSS px
attribute float aShape;
attribute vec4 aFill;
attribute vec4 aStroke;
uniform vec2 u_origin;
uniform vec2 u_ex;
uniform vec2 u_ey;
uniform vec2 u_viewport;
uniform float u_scalePx;    // CSS px -> device px (dpr)
uniform float u_outlinePx;  // outline width, device px
varying vec2 vLocal;        // device px offset from the anchor
varying float vSizePx;      // half-extent, device px
varying float vShape;
varying vec4 vFill;
varying vec4 vStroke;
void main() {
  vec2 centerDev = u_origin + aCenter.x * u_ex + aCenter.y * u_ey;
  float sizePx = max(1.0, aSizePx * u_scalePx);
  float outerPx = sizePx + u_outlinePx;
  vLocal = corner * outerPx;
  vSizePx = sizePx;
  vShape = aShape;
  vFill = aFill;
  vStroke = aStroke;
  vec2 posDev = centerDev + vLocal;
  vec2 clip = vec2(posDev.x / u_viewport.x * 2.0 - 1.0, 1.0 - posDev.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

// SDF helpers (Inigo Quilez). p is device-px offset from the anchor; r is the
// half-extent in device px. Negative inside.
const FRAG = `
precision highp float;
varying vec2 vLocal;
varying float vSizePx;
varying float vShape;
varying vec4 vFill;
varying vec4 vStroke;
uniform float u_outlinePx;

float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, float r) {
  vec2 d = abs(p) - vec2(r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdEquilateralTriangle(vec2 p, float r) {
  const float k = 1.7320508;      // sqrt(3)
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdPentagon(vec2 p, float r) {
  const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
  p.x = abs(p.x);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
  p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);
  return length(p) * sign(p.y);
}
// A plus/cross: union of two thin bars sized to the marker.
float sdCross(vec2 p, float r) {
  float t = r * 0.34;
  vec2 a = abs(p);
  float bx = max(a.x - r, a.y - t);
  float by = max(a.x - t, a.y - r);
  return min(bx, by);
}

void main() {
  float r = vSizePx;
  vec2 p = vLocal;
  int shape = int(vShape + 0.5);
  float sdf;
  bool outlineOnly = false;
  if (shape == 1) { sdf = sdCircle(p, r); outlineOnly = true; }     // ring
  else if (shape == 2) { sdf = sdEquilateralTriangle(vec2(p.x, -p.y), r); } // triangle (point up)
  else if (shape == 3) { sdf = sdBox(p, r); }                       // square
  else if (shape == 4) { sdf = sdPentagon(vec2(p.x, -p.y), r); }    // pentagon (point up)
  else if (shape == 5) { sdf = sdCross(p, r); }                     // cross
  else { sdf = sdCircle(p, r); }                                    // disc

  float aa = 1.0;
  float halfW = max(u_outlinePx * 0.5, 0.75);
  float fillMask = outlineOnly ? 0.0 : (1.0 - smoothstep(-aa, aa, sdf));
  float outlineMask = 1.0 - smoothstep(halfW - aa, halfW + aa, abs(sdf));
  vec4 color = mix(vFill * fillMask, vStroke, outlineMask);
  float alpha = color.a;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(color.rgb * alpha, alpha);
}`;

const QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

export interface MarkerDrawProps {
  view: ViewTransform;
  viewport: Viewport;
  /** CSS px -> device px (dpr). */
  scalePx: number;
  /** Outline width, device px. */
  outlinePx: number;
}

export interface MarkerProgram {
  setData(geometry: MarkerGeometry): void;
  draw(props: MarkerDrawProps): void;
  dispose(): void;
}

type Vec2 = [number, number];

interface MarkerDrawParams {
  originArr: Vec2;
  exArr: Vec2;
  eyArr: Vec2;
  viewportArr: Vec2;
  scalePx: number;
  outlinePx: number;
  centerBuf: Buffer;
  sizeBuf: Buffer;
  shapeBuf: Buffer;
  fillBuf: Buffer;
  strokeBuf: Buffer;
  instanceCount: number;
}

interface MarkerUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
  u_scalePx: number;
  u_outlinePx: number;
}

interface MarkerAttributes {
  corner: unknown;
  aCenter: unknown;
  aSizePx: unknown;
  aShape: unknown;
  aFill: unknown;
  aStroke: unknown;
}

export function createMarkerProgram(regl: Regl): MarkerProgram {
  const quad = regl.buffer(QUAD);
  let centerBuf: Buffer | null = null;
  let sizeBuf: Buffer | null = null;
  let shapeBuf: Buffer | null = null;
  let fillBuf: Buffer | null = null;
  let strokeBuf: Buffer | null = null;
  let count = 0;

  const draw = regl<MarkerUniforms, MarkerAttributes, MarkerDrawParams>({
    vert: VERT,
    frag: FRAG,
    attributes: {
      corner: quad,
      aCenter: { buffer: (_c: unknown, props: MarkerDrawParams) => props.centerBuf, divisor: 1 },
      aSizePx: { buffer: (_c: unknown, props: MarkerDrawParams) => props.sizeBuf, divisor: 1 },
      aShape: { buffer: (_c: unknown, props: MarkerDrawParams) => props.shapeBuf, divisor: 1 },
      aFill: { buffer: (_c: unknown, props: MarkerDrawParams) => props.fillBuf, divisor: 1 },
      aStroke: { buffer: (_c: unknown, props: MarkerDrawParams) => props.strokeBuf, divisor: 1 },
    },
    uniforms: {
      u_origin: (_ctx, props) => props.originArr,
      u_ex: (_ctx, props) => props.exArr,
      u_ey: (_ctx, props) => props.eyArr,
      u_viewport: (_ctx, props) => props.viewportArr,
      u_scalePx: (_ctx, props) => props.scalePx,
      u_outlinePx: (_ctx, props) => props.outlinePx,
    },
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
      sizeBuf?.destroy();
      shapeBuf?.destroy();
      fillBuf?.destroy();
      strokeBuf?.destroy();
      centerBuf = regl.buffer(geometry.center);
      sizeBuf = regl.buffer(geometry.size);
      shapeBuf = regl.buffer(geometry.shape);
      fillBuf = regl.buffer(geometry.fill);
      strokeBuf = regl.buffer(geometry.stroke);
    },
    draw({ view, viewport, scalePx, outlinePx }) {
      if (count === 0 || !centerBuf || !sizeBuf || !shapeBuf || !fillBuf || !strokeBuf) return;
      draw({
        originArr: [view.origin[0], view.origin[1]],
        exArr: [view.ex[0], view.ex[1]],
        eyArr: [view.ey[0], view.ey[1]],
        viewportArr: [viewport.width, viewport.height],
        scalePx,
        outlinePx,
        centerBuf,
        sizeBuf,
        shapeBuf,
        fillBuf,
        strokeBuf,
        instanceCount: count,
      });
    },
    dispose() {
      quad.destroy();
      centerBuf?.destroy();
      sizeBuf?.destroy();
      shapeBuf?.destroy();
      fillBuf?.destroy();
      strokeBuf?.destroy();
    },
  };
}

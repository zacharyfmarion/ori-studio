import type createREGL from 'regl';
import {
  MAX_DASH_RUNS,
  MAX_DASH_SLOTS,
  type StrokeGeometry,
  type ViewTransform,
  type Viewport,
} from '../types';
import { disposeOnce } from './disposeOnce';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;

/**
 * Instanced stroke program: draws each segment as a screen-space-width quad.
 * Positions are transformed model -> device via the {@link ViewTransform} basis,
 * then the quad is extruded along the segment normal by a device-pixel width, so
 * line width is controlled explicitly (matching the SVG's rendered stroke).
 *
 * Segments may dash: each instance carries a slot index into a small table of
 * patterns ({@link MAX_DASH_SLOTS} of them). The slot is resolved to its on/off
 * runs in the vertex stage — GLSL ES 1.0 cannot index a uniform array by a
 * non-constant expression in the fragment stage — and the fragment stage
 * discards whatever lands in a gap.
 *
 * There is no dash *phase*: every segment's pattern starts at its own `a`
 * endpoint, because `vDist` is distance from that endpoint and nothing offsets
 * it. Patterns are written to want none — a pattern whose first ink is `d` px
 * along inks nothing whatsoever on a segment shorter than `d`, and most
 * segments are short, so a phase here is a pattern that vanishes rather than a
 * pattern that shifts. See `alternateDashRuns` in `lib/oristudioCpLineStyle`,
 * which is where that was learned.
 */
const VERT = `
precision highp float;
attribute vec2 corner;   // (t in {0,1} along segment, side in {-0.5,0.5})
attribute vec2 aA;       // segment start, model coords
attribute vec2 aB;       // segment end, model coords
attribute vec4 aColor;
attribute float aWidthMul; // per-segment width multiplier
attribute float aDashSlot; // per-segment dash slot (0 = solid)
// Draw order in [0, 1], 0 farthest. Zero without depth ordering, where every
// segment lands at the same z and plain painter order survives.
attribute float aDepth;
uniform vec2 u_origin;   // device px of model (0,0)
uniform vec2 u_ex;       // device delta per +1 model x
uniform vec2 u_ey;       // device delta per +1 model y
uniform vec2 u_viewport; // device px
uniform float u_widthPx; // base stroke width, device px
uniform vec3 u_dashOn1;  // slot 1 "on" run lengths, device px
uniform vec3 u_dashOff1; // slot 1 gap lengths, device px
uniform vec3 u_dashOn2;
uniform vec3 u_dashOff2;
uniform vec3 u_dashOn3;
uniform vec3 u_dashOff3;
uniform vec3 u_dashOn4;
uniform vec3 u_dashOff4;
varying vec4 vColor;
varying float vDist;     // device px along the segment (for screen-space dashing)
varying vec3 vDashOn;
varying vec3 vDashOff;
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
  // Nearer segments get smaller z, which is what LEQUAL wants.
  gl_Position = vec4(clip, 1.0 - 2.0 * aDepth, 1.0);
  vColor = aColor;
  vDist = corner.x * len;
  if (aDashSlot > 3.5) {
    vDashOn = u_dashOn4;
    vDashOff = u_dashOff4;
  } else if (aDashSlot > 2.5) {
    vDashOn = u_dashOn3;
    vDashOff = u_dashOff3;
  } else if (aDashSlot > 1.5) {
    vDashOn = u_dashOn2;
    vDashOff = u_dashOff2;
  } else if (aDashSlot > 0.5) {
    vDashOn = u_dashOn1;
    vDashOff = u_dashOff1;
  } else {
    vDashOn = vec3(0.0);
    vDashOff = vec3(0.0);
  }
}`;

const FRAG = `
precision highp float;
varying vec4 vColor;
varying float vDist;
varying vec3 vDashOn;
varying vec3 vDashOff;
// Walk the pattern's runs: inside an "on" run the fragment is drawn, inside a
// gap it is discarded. A run of length 0 collapses, so shorter patterns just
// leave their trailing runs empty.
bool inDash(float distance) {
  float period = dot(vDashOn, vec3(1.0)) + dot(vDashOff, vec3(1.0));
  if (period <= 0.0) return true;
  float t = mod(distance, period);
  if (t < vDashOn.x) return true;
  t -= vDashOn.x + vDashOff.x;
  if (t < 0.0) return false;
  if (t < vDashOn.y) return true;
  t -= vDashOn.y + vDashOff.y;
  if (t < 0.0) return false;
  return t < vDashOn.z;
}
void main() {
  if (!inDash(vDist)) discard;
  gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`;

/** Unit quad (two triangles) parameterised as (t, side). */
const QUAD = new Float32Array([0, -0.5, 1, -0.5, 1, 0.5, 0, -0.5, 1, 0.5, 0, 0.5]);

/** A dash pattern flattened into the shader's parallel on/off run vectors. */
export interface DashSlotUniforms {
  on: readonly [number, number, number];
  off: readonly [number, number, number];
}

const SOLID_SLOT: DashSlotUniforms = { on: [0, 0, 0], off: [0, 0, 0] };

/**
 * Split a dash pattern's alternating run lengths into the shader's on/off
 * vectors, scaled from CSS px to device px. Runs past {@link MAX_DASH_RUNS} are
 * dropped — no Oriedita pattern uses more.
 */
export function dashSlotUniforms(pattern: readonly number[], dpr: number): DashSlotUniforms {
  const on: number[] = [0, 0, 0];
  const off: number[] = [0, 0, 0];
  for (let run = 0; run < MAX_DASH_RUNS; run += 1) {
    on[run] = (pattern[run * 2] ?? 0) * dpr;
    off[run] = (pattern[run * 2 + 1] ?? 0) * dpr;
  }
  return { on: [on[0], on[1], on[2]], off: [off[0], off[1], off[2]] };
}

/** Resolve a geometry's pattern table to the fixed set of slot uniforms. */
export function dashTableUniforms(
  patterns: readonly (readonly number[])[] | undefined,
  dpr: number
): DashSlotUniforms[] {
  const slots: DashSlotUniforms[] = [];
  for (let slot = 0; slot < MAX_DASH_SLOTS; slot += 1) {
    const pattern = patterns?.[slot];
    slots.push(pattern ? dashSlotUniforms(pattern, dpr) : SOLID_SLOT);
  }
  return slots;
}

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
type Vec3 = readonly [number, number, number];

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
  dashOn1: Vec3;
  dashOff1: Vec3;
  dashOn2: Vec3;
  dashOff2: Vec3;
  dashOn3: Vec3;
  dashOff3: Vec3;
  dashOn4: Vec3;
  dashOff4: Vec3;
  aBuf: Buffer;
  bBuf: Buffer;
  colorBuf: Buffer;
  widthMulBuf: Buffer;
  depthBuf: Buffer;
  dashSlotBuf: Buffer;
  instanceCount: number;
}

/** Uniform key shapes for the regl command generic. */
interface StrokeUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
  u_widthPx: number;
  u_dashOn1: Vec3;
  u_dashOff1: Vec3;
  u_dashOn2: Vec3;
  u_dashOff2: Vec3;
  u_dashOn3: Vec3;
  u_dashOff3: Vec3;
  u_dashOn4: Vec3;
  u_dashOff4: Vec3;
}

/** Attribute key shapes; values are regl attribute configs (kept permissive). */
interface StrokeAttributes {
  corner: unknown;
  aA: unknown;
  aB: unknown;
  aColor: unknown;
  aWidthMul: unknown;
  aDashSlot: unknown;
  aDepth: unknown;
}

/**
 * The per-segment slot buffer contents: the geometry's own slots, or a uniform
 * fill when it dashes every segment the same way (or not at all).
 */
function dashSlots(geometry: StrokeGeometry): Float32Array {
  if (geometry.dashSlot) return geometry.dashSlot;
  const uniformSlot = geometry.dashPatterns?.length ? 1 : 0;
  return new Float32Array(geometry.count).fill(uniformSlot);
}

export interface StrokeProgramOptions {
  /**
   * Respect the geometry's `depth` attribute instead of drawing in call order.
   *
   * Set only for the *generated* folded figures. Their fills and creases are one
   * painter-ordered stream that the canvas splits into two batched draws, so a
   * crease behind a face otherwise draws over it. Every other user of this
   * program — creases, grid, preview, diagnostics, imported translucent forms —
   * is genuinely 2D and keeps plain painter order.
   */
  depthOrdered?: boolean;
}

export function createStrokeProgram(
  regl: Regl,
  options: StrokeProgramOptions = {}
): StrokeProgram {
  const quad = regl.buffer(QUAD);
  let aBuf: Buffer | null = null;
  let bBuf: Buffer | null = null;
  let colorBuf: Buffer | null = null;
  let widthMulBuf: Buffer | null = null;
  let depthBuf: Buffer | null = null;
  let dashSlotBuf: Buffer | null = null;
  let count = 0;
  let dashPatterns: readonly (readonly number[])[] | undefined;

  const draw = regl<StrokeUniforms, StrokeAttributes, StrokeDrawParams>({
    vert: VERT,
    frag: FRAG,
    attributes: {
      corner: quad,
      aA: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.aBuf, divisor: 1 },
      aB: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.bBuf, divisor: 1 },
      aColor: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.colorBuf, divisor: 1 },
      aWidthMul: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.widthMulBuf, divisor: 1 },
      aDepth: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.depthBuf, divisor: 1 },
      aDashSlot: { buffer: (_ctx: unknown, props: StrokeDrawParams) => props.dashSlotBuf, divisor: 1 },
    },
    uniforms: {
      u_origin: (_ctx, props) => props.originArr,
      u_ex: (_ctx, props) => props.exArr,
      u_ey: (_ctx, props) => props.eyArr,
      u_viewport: (_ctx, props) => props.viewportArr,
      u_widthPx: (_ctx, props) => props.widthPx,
      u_dashOn1: (_ctx, props) => props.dashOn1,
      u_dashOff1: (_ctx, props) => props.dashOff1,
      u_dashOn2: (_ctx, props) => props.dashOn2,
      u_dashOff2: (_ctx, props) => props.dashOff2,
      u_dashOn3: (_ctx, props) => props.dashOn3,
      u_dashOff3: (_ctx, props) => props.dashOff3,
      u_dashOn4: (_ctx, props) => props.dashOn4,
      u_dashOff4: (_ctx, props) => props.dashOff4,
    },
    // Premultiplied-alpha blend: a no-op for opaque creases (alpha 1), and lets
    // semi-transparent strokes (e.g. grid lines) composite over the background.
    blend: {
      enable: true,
      func: { srcRGB: 1, srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' },
    },
    depth: options.depthOrdered
      ? { enable: true, mask: true, func: 'lequal' }
      : { enable: false },
    count: 6,
    instances: (_ctx, props) => props.instanceCount,
  });

  return {
    setData(geometry) {
      count = geometry.count;
      dashPatterns = geometry.dashPatterns;
      aBuf?.destroy();
      bBuf?.destroy();
      colorBuf?.destroy();
      widthMulBuf?.destroy();
      depthBuf?.destroy();
      dashSlotBuf?.destroy();
      aBuf = regl.buffer(geometry.a);
      bBuf = regl.buffer(geometry.b);
      colorBuf = regl.buffer(geometry.color);
      widthMulBuf = regl.buffer(geometry.widthMul);
      // Absent depths mean "all at the same z", which under LEQUAL degrades
      // exactly to the painter order this program had before.
      depthBuf = regl.buffer(geometry.depth ?? new Float32Array(geometry.count));
      dashSlotBuf = regl.buffer(dashSlots(geometry));
    },
    draw({ view, viewport, widthPx }) {
      if (count === 0 || !aBuf || !bBuf || !colorBuf || !widthMulBuf || !dashSlotBuf || !depthBuf)
        return;
      const [slot1, slot2, slot3, slot4] = dashTableUniforms(dashPatterns, viewport.dpr);
      draw({
        originArr: [view.origin[0], view.origin[1]],
        exArr: [view.ex[0], view.ex[1]],
        eyArr: [view.ey[0], view.ey[1]],
        viewportArr: [viewport.width, viewport.height],
        widthPx: Math.max(1, widthPx),
        dashOn1: slot1.on,
        dashOff1: slot1.off,
        dashOn2: slot2.on,
        dashOff2: slot2.off,
        dashOn3: slot3.on,
        dashOff3: slot3.off,
        dashOn4: slot4.on,
        dashOff4: slot4.off,
        aBuf,
        bBuf,
        colorBuf,
        widthMulBuf,
        depthBuf,
        dashSlotBuf,
        instanceCount: count,
      });
    },
    dispose: disposeOnce(() => {
      quad.destroy();
      aBuf?.destroy();
      bBuf?.destroy();
      colorBuf?.destroy();
      widthMulBuf?.destroy();
      depthBuf?.destroy();
      dashSlotBuf?.destroy();
    }),
  };
}

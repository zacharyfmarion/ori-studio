import type createREGL from 'regl';
import { MAX_SHADOW_EDGES, SHADOW_PROFILE_GLSL } from '../../folded/foldedShadowProfile';
import type { ShadowGeometry, ViewTransform, Viewport } from '../types';
import { disposeOnce } from './disposeOnce';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;
type Texture = ReturnType<Regl['texture']>;

/**
 * Layer shadows over folded-figure paper.
 *
 * Triangles cover the paper that receives a shadow (the same polygons as the
 * fills); each fragment takes its distance to each of the casting outline
 * segments its vertices name, darkens by the shared occlusion curve of that
 * distance at the segment's ledge height, and keeps the darkest. Evaluating
 * the field per fragment is what makes the shadow continuous along a split
 * edge, rounded at corners, single-valued where two bands would overlap, and
 * confined to the receiving paper — everything a band of triangles per edge
 * could not be.
 *
 * WebGL1 only. The segment list lives in an RGBA8 texture — 16 bits per
 * coordinate over the scene's bounds, then the ledge height, three texels a
 * segment — so no float texture extension is needed, and the loop has the
 * constant bound GLSL ES 1.00 requires with an early break.
 */
const VERT = `
precision highp float;
attribute vec2 position;   // user coords
attribute float aDepth;    // draw order in [0, 1], 0 farthest — see fillProgram
attribute vec2 aEdgeRange; // first casting segment, count
attribute vec2 aFalloff;   // one sheet's thickness in user units, contact darkness
uniform vec2 u_origin;
uniform vec2 u_ex;
uniform vec2 u_ey;
uniform vec2 u_viewport;
varying vec2 vUser;
varying vec2 vEdgeRange;
varying vec2 vFalloff;
varying float vPxPerUnit;  // device pixels per user unit, for the pixel floor
void main() {
  vec2 dev = u_origin + position.x * u_ex + position.y * u_ey;
  vec2 clip = vec2(dev.x / u_viewport.x * 2.0 - 1.0, 1.0 - dev.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 1.0 - 2.0 * aDepth, 1.0);
  vUser = position;
  vEdgeRange = aEdgeRange;
  vFalloff = aFalloff;
  vPxPerUnit = length(u_ex);
}`;

const FRAG = `
precision highp float;
varying vec2 vUser;
varying vec2 vEdgeRange;
varying vec2 vFalloff;
varying float vPxPerUnit;
uniform sampler2D u_edges;
uniform vec2 u_edgeTexSize; // texels
uniform vec2 u_edgeMin;     // user coords the packed 0 stands for
uniform vec2 u_edgeSpan;    // user coords the packed 65535 stands for, from there
const int MAX_SHADOW_EDGES = ${MAX_SHADOW_EDGES};

vec4 fetchTexel(float texel) {
  float col = mod(texel, u_edgeTexSize.x);
  float row = floor(texel / u_edgeTexSize.x);
  return texture2D(u_edges, (vec2(col, row) + 0.5) / u_edgeTexSize);
}

vec2 fetchPoint(float texel) {
  vec4 t = fetchTexel(texel);
  // ('packed' is a reserved word in GLSL ES 1.00.)
  vec2 quantized = vec2(t.r * 255.0 * 256.0 + t.g * 255.0, t.b * 255.0 * 256.0 + t.a * 255.0);
  return u_edgeMin + quantized / 65535.0 * u_edgeSpan;
}

float fetchStep(float texel) {
  return fetchTexel(texel).r * 255.0;
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len2 = dot(ab, ab);
  float t = len2 > 0.0 ? clamp(dot(p - a, ab) / len2, 0.0, 1.0) : 0.0;
  return length(p - (a + ab * t));
}
${SHADOW_PROFILE_GLSL}
void main() {
  // Every vertex of a triangle carries the same range, so the interpolated
  // value is exact up to rounding; snap it back to the integer it was.
  float start = floor(vEdgeRange.x + 0.5);
  float count = floor(vEdgeRange.y + 0.5);
  // Each ledge casts its own shadow; the fragment shows the darkest. For
  // ledges of one height that is the nearest edge; a taller ledge further
  // away can win over a lower one nearby. A ledge too thin to resolve is
  // widened to a pixel or two and lightened by as much (shadowLedgeBoost).
  float a = 0.0;
  for (int i = 0; i < MAX_SHADOW_EDGES; i++) {
    if (float(i) >= count) break;
    float texel = (start + float(i)) * 3.0;
    float d = segmentDistance(vUser, fetchPoint(texel), fetchPoint(texel + 1.0));
    float height = shadowLedgeHeight(fetchStep(texel + 2.0), vFalloff.x);
    float boost = shadowLedgeBoost(height * vPxPerUnit);
    a = max(a, vFalloff.y / boost * shadowProfile(d, height * boost));
  }
  gl_FragColor = vec4(0.0, 0.0, 0.0, a); // premultiplied black
}`;

/** Texels per row of the segment texture. Three texels a segment. */
export const SHADOW_EDGE_TEXTURE_WIDTH = 256;
/** Texels each segment occupies: its two endpoints, then its ledge height. */
export const TEXELS_PER_EDGE = 3;

export interface PackedShadowEdges {
  data: Uint8Array;
  width: number;
  height: number;
  /** User coordinates a packed 0 decodes to. */
  min: [number, number];
  /** User extent a packed 65535 spans from `min`; never 0, so decoding is well-defined. */
  span: [number, number];
}

/**
 * Pack `[x0, y0, x1, y1] * edgeCount` and each segment's ledge height into
 * RGBA8 texels, 16 bits a coordinate relative to the segments' bounds: texel
 * `3e` is segment `e`'s start, `3e + 1` its end, each `(hi x, lo x, hi y,
 * lo y)`, and `3e + 2` holds the height in its red channel.
 *
 * 16 bits over a scene of a few thousand user units resolves under 0.1 of a
 * unit, against a shadow reach of ten or more — a shift nothing shows.
 */
export function packShadowEdges(
  edges: Float32Array,
  edgeSteps: Uint8Array,
  edgeCount: number
): PackedShadowEdges {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < edgeCount * 4; i += 2) {
    const x = edges[i];
    const y = edges[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (edgeCount === 0) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const span: [number, number] = [Math.max(maxX - minX, 1e-6), Math.max(maxY - minY, 1e-6)];
  const width = SHADOW_EDGE_TEXTURE_WIDTH;
  const height = Math.max(1, Math.ceil((edgeCount * TEXELS_PER_EDGE) / width));
  const data = new Uint8Array(width * height * 4);
  const quantize = (value: number, min: number, extent: number) =>
    Math.max(0, Math.min(65535, Math.round(((value - min) / extent) * 65535)));
  for (let edge = 0; edge < edgeCount; edge++) {
    for (let end = 0; end < 2; end++) {
      const qx = quantize(edges[edge * 4 + end * 2], minX, span[0]);
      const qy = quantize(edges[edge * 4 + end * 2 + 1], minY, span[1]);
      const at = (edge * TEXELS_PER_EDGE + end) * 4;
      data[at] = qx >> 8;
      data[at + 1] = qx & 255;
      data[at + 2] = qy >> 8;
      data[at + 3] = qy & 255;
    }
    data[(edge * TEXELS_PER_EDGE + 2) * 4] = Math.max(1, Math.min(255, edgeSteps[edge] ?? 1));
  }
  return { data, width, height, min: [minX, minY], span };
}

/**
 * Decode one endpoint of a packed segment back to user coordinates — the
 * shader's `fetchPoint`, for tests.
 */
export function unpackShadowPoint(
  packed: PackedShadowEdges,
  edge: number,
  end: 0 | 1
): [number, number] {
  const at = (edge * TEXELS_PER_EDGE + end) * 4;
  const qx = packed.data[at] * 256 + packed.data[at + 1];
  const qy = packed.data[at + 2] * 256 + packed.data[at + 3];
  return [
    packed.min[0] + (qx / 65535) * packed.span[0],
    packed.min[1] + (qy / 65535) * packed.span[1],
  ];
}

/** A packed segment's ledge height — the shader's `fetchStep`, for tests. */
export function unpackShadowStep(packed: PackedShadowEdges, edge: number): number {
  return packed.data[(edge * TEXELS_PER_EDGE + 2) * 4];
}

export interface ShadowDrawProps {
  view: ViewTransform;
  viewport: Viewport;
}

export interface ShadowProgram {
  setData(geometry: ShadowGeometry): void;
  draw(props: ShadowDrawProps): void;
  dispose(): void;
}

type Vec2 = [number, number];

interface ShadowDrawParams {
  originArr: Vec2;
  exArr: Vec2;
  eyArr: Vec2;
  viewportArr: Vec2;
  positionBuf: Buffer;
  depthBuf: Buffer;
  edgeRangeBuf: Buffer;
  falloffBuf: Buffer;
  edgeTexture: Texture;
  edgeTexSize: Vec2;
  edgeMin: Vec2;
  edgeSpan: Vec2;
  vertexCount: number;
}

interface ShadowUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
  u_edges: Texture;
  u_edgeTexSize: Vec2;
  u_edgeMin: Vec2;
  u_edgeSpan: Vec2;
}

interface ShadowAttributes {
  position: unknown;
  aDepth: unknown;
  aEdgeRange: unknown;
  aFalloff: unknown;
}

export function createShadowProgram(regl: Regl): ShadowProgram {
  let positionBuf: Buffer | null = null;
  let depthBuf: Buffer | null = null;
  let edgeRangeBuf: Buffer | null = null;
  let falloffBuf: Buffer | null = null;
  let edgeTexture: Texture | null = null;
  let packed: PackedShadowEdges | null = null;
  let count = 0;

  const draw = regl<ShadowUniforms, ShadowAttributes, ShadowDrawParams>({
    vert: VERT,
    frag: FRAG,
    attributes: {
      position: (_ctx: unknown, props: ShadowDrawParams) => props.positionBuf,
      aDepth: (_ctx: unknown, props: ShadowDrawParams) => props.depthBuf,
      aEdgeRange: (_ctx: unknown, props: ShadowDrawParams) => props.edgeRangeBuf,
      aFalloff: (_ctx: unknown, props: ShadowDrawParams) => props.falloffBuf,
    },
    uniforms: {
      u_origin: (_ctx, props) => props.originArr,
      u_ex: (_ctx, props) => props.exArr,
      u_ey: (_ctx, props) => props.eyArr,
      u_viewport: (_ctx, props) => props.viewportArr,
      u_edges: (_ctx: unknown, props: ShadowDrawParams) => props.edgeTexture,
      u_edgeTexSize: (_ctx, props) => props.edgeTexSize,
      u_edgeMin: (_ctx, props) => props.edgeMin,
      u_edgeSpan: (_ctx, props) => props.edgeSpan,
    },
    // Premultiplied over, like the fills it darkens.
    blend: {
      enable: true,
      func: { srcRGB: 1, srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' },
    },
    // Ordered with the fills and strokes of its figure — see fillProgram.
    depth: { enable: true, mask: true, func: 'lequal' },
    count: (_ctx, props) => props.vertexCount,
  });

  return {
    setData(geometry) {
      count = geometry.count;
      positionBuf?.destroy();
      depthBuf?.destroy();
      edgeRangeBuf?.destroy();
      falloffBuf?.destroy();
      edgeTexture?.destroy();
      positionBuf = regl.buffer(geometry.position);
      depthBuf = regl.buffer(geometry.depth);
      edgeRangeBuf = regl.buffer(geometry.edgeRange);
      falloffBuf = regl.buffer(geometry.falloff);
      packed = packShadowEdges(geometry.edges, geometry.edgeSteps, geometry.edgeCount);
      edgeTexture = regl.texture({
        width: packed.width,
        height: packed.height,
        data: packed.data,
        format: 'rgba',
        type: 'uint8',
        // Texels are records, not an image: never blend neighbours.
        min: 'nearest',
        mag: 'nearest',
        wrapS: 'clamp',
        wrapT: 'clamp',
      });
    },
    draw({ view, viewport }) {
      if (
        count === 0 ||
        !positionBuf ||
        !depthBuf ||
        !edgeRangeBuf ||
        !falloffBuf ||
        !edgeTexture ||
        !packed
      ) {
        return;
      }
      draw({
        originArr: [view.origin[0], view.origin[1]],
        exArr: [view.ex[0], view.ex[1]],
        eyArr: [view.ey[0], view.ey[1]],
        viewportArr: [viewport.width, viewport.height],
        positionBuf,
        depthBuf,
        edgeRangeBuf,
        falloffBuf,
        edgeTexture,
        edgeTexSize: [packed.width, packed.height],
        edgeMin: packed.min,
        edgeSpan: packed.span,
        vertexCount: count,
      });
    },
    dispose: disposeOnce(() => {
      positionBuf?.destroy();
      depthBuf?.destroy();
      edgeRangeBuf?.destroy();
      falloffBuf?.destroy();
      edgeTexture?.destroy();
    }),
  };
}

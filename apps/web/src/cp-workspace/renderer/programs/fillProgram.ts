import type createREGL from 'regl';
import type { FillGeometry, ViewTransform, Viewport } from '../types';
import { disposeOnce } from './disposeOnce';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;

/**
 * Triangle-soup fill program for folded-figure facets. Positions arrive in SVG
 * user coordinates and are mapped to device pixels by the {@link ViewTransform}
 * basis. Per-vertex RGBA with premultiplied-alpha blending composites the
 * overlapping, semi-transparent facets in draw (paint) order.
 */
const VERT = `
precision highp float;
attribute vec2 position; // user coords
attribute vec4 aColor;
// Draw order in [0, 1], 0 farthest. Zero on a program without depth ordering,
// where every primitive lands at the same z and plain painter order survives.
attribute float aDepth;
uniform vec2 u_origin;
uniform vec2 u_ex;
uniform vec2 u_ey;
uniform vec2 u_viewport;
varying vec4 vColor;
void main() {
  vec2 dev = u_origin + position.x * u_ex + position.y * u_ey;
  vec2 clip = vec2(dev.x / u_viewport.x * 2.0 - 1.0, 1.0 - dev.y / u_viewport.y * 2.0);
  // Nearer primitives get smaller z, which is what LEQUAL wants: a later
  // primitive (larger aDepth) passes over an earlier one at the same pixel.
  gl_Position = vec4(clip, 1.0 - 2.0 * aDepth, 1.0);
  vColor = aColor;
}`;

const FRAG = `
precision highp float;
varying vec4 vColor;
void main() { gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

export interface FillDrawProps {
  view: ViewTransform;
  viewport: Viewport;
}

export interface FillProgram {
  setData(geometry: FillGeometry): void;
  draw(props: FillDrawProps): void;
  dispose(): void;
}

type Vec2 = [number, number];

interface FillDrawParams {
  originArr: Vec2;
  exArr: Vec2;
  eyArr: Vec2;
  viewportArr: Vec2;
  positionBuf: Buffer;
  colorBuf: Buffer;
  depthBuf: Buffer;
  vertexCount: number;
}

interface FillUniforms {
  u_origin: Vec2;
  u_ex: Vec2;
  u_ey: Vec2;
  u_viewport: Vec2;
}

interface FillAttributes {
  position: unknown;
  aColor: unknown;
  aDepth: unknown;
}

export interface FillProgramOptions {
  /**
   * Respect the geometry's `depth` attribute instead of drawing in call order.
   *
   * Only the *generated* folded figures want this. Their fills and strokes are
   * one painter-ordered stream that the canvas splits into two batched draws, so
   * without a depth test a crease behind a face still draws over it. Imported
   * `.fold` forms are translucent and must keep plain painter order, and every
   * other surface on this canvas is genuinely 2D.
   */
  depthOrdered?: boolean;
}

export function createFillProgram(regl: Regl, options: FillProgramOptions = {}): FillProgram {
  let positionBuf: Buffer | null = null;
  let colorBuf: Buffer | null = null;
  let depthBuf: Buffer | null = null;
  let count = 0;

  const draw = regl<FillUniforms, FillAttributes, FillDrawParams>({
    vert: VERT,
    frag: FRAG,
    attributes: {
      position: (_ctx: unknown, props: FillDrawParams) => props.positionBuf,
      aColor: (_ctx: unknown, props: FillDrawParams) => props.colorBuf,
      aDepth: (_ctx: unknown, props: FillDrawParams) => props.depthBuf,
    },
    uniforms: {
      u_origin: (_ctx, props) => props.originArr,
      u_ex: (_ctx, props) => props.exArr,
      u_ey: (_ctx, props) => props.eyArr,
      u_viewport: (_ctx, props) => props.viewportArr,
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
    depth: options.depthOrdered ? { enable: true, mask: true, func: 'lequal' } : { enable: false },
    count: (_ctx, props) => props.vertexCount,
  });

  return {
    setData(geometry) {
      count = geometry.count;
      positionBuf?.destroy();
      colorBuf?.destroy();
      depthBuf?.destroy();
      positionBuf = regl.buffer(geometry.position);
      colorBuf = regl.buffer(geometry.color);
      // Absent depths mean "all at the same z", which under LEQUAL degrades
      // exactly to the painter order this program had before.
      depthBuf = regl.buffer(geometry.depth ?? new Float32Array(geometry.count));
    },
    draw({ view, viewport }) {
      if (count === 0 || !positionBuf || !colorBuf || !depthBuf) return;
      draw({
        originArr: [view.origin[0], view.origin[1]],
        exArr: [view.ex[0], view.ex[1]],
        eyArr: [view.ey[0], view.ey[1]],
        viewportArr: [viewport.width, viewport.height],
        positionBuf,
        colorBuf,
        depthBuf,
        vertexCount: count,
      });
    },
    dispose: disposeOnce(() => {
      positionBuf?.destroy();
      colorBuf?.destroy();
      depthBuf?.destroy();
    }),
  };
}

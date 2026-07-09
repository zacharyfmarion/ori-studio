// THROWAWAY Phase 0 spike — regl renderer with two programs:
//   1. instanced strokes (crease lines + facet edges), screen-space width
//   2. triangulated fills (folded facets), alpha-blended in buffer/paint order
// Deliberately loose typing (regl as any) — esbuild transpiles without tsc.

import createREGL from 'regl';
import type { FillData, StrokeData } from './geometry';
import type { Camera, Viewport } from './camera';
import { cameraUniforms } from './camera';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SpikeRenderer {
  regl: any;
  draw(cam: Camera, vp: Viewport, opts: { drawFills: boolean; highlight: number }): void;
  setHighlight(strokes: StrokeData, idx: number): void;
  destroy(): void;
}

const STROKE_VERT = `
precision highp float;
attribute vec2 corner;   // (t in {0,1}, side in {-0.5,0.5})
attribute vec2 aA;
attribute vec2 aB;
attribute vec3 aColor;
attribute float aWidth;
uniform vec2 u_center;
uniform float u_zoom;
uniform vec2 u_viewport;
varying vec3 vColor;
vec2 worldToScreen(vec2 w){ return (w - u_center) * u_zoom + u_viewport * 0.5; }
void main() {
  vec2 sA = worldToScreen(aA);
  vec2 sB = worldToScreen(aB);
  vec2 d = sB - sA;
  float len = length(d);
  d = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-d.y, d.x);
  vec2 pos = mix(sA, sB, corner.x) + nrm * aWidth * corner.y;
  vec2 clip = vec2(pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - pos.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aColor;
}`;

// Highlight is drawn as a separate single-instance pass, so the stroke frag is
// just a passthrough of the per-instance colour.
const STROKE_FRAG = `
precision highp float;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }`;

const FILL_VERT = `
precision highp float;
attribute vec2 position;
attribute vec4 aColor;
uniform vec2 u_center;
uniform float u_zoom;
uniform vec2 u_viewport;
varying vec4 vColor;
void main() {
  vec2 s = (position - u_center) * u_zoom + u_viewport * 0.5;
  vec2 clip = vec2(s.x / u_viewport.x * 2.0 - 1.0, 1.0 - s.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aColor;
}`;

const FILL_FRAG = `
precision highp float;
varying vec4 vColor;
void main() { gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

// unit quad as two triangles: (t, side)
const QUAD = new Float32Array([
  0, -0.5, 1, -0.5, 1, 0.5,
  0, -0.5, 1, 0.5, 0, 0.5,
]);

export function createSpikeRenderer(
  canvas: HTMLCanvasElement,
  strokes: StrokeData,
  fills: FillData
): SpikeRenderer {
  const regl = createREGL({
    canvas,
    extensions: ['ANGLE_instanced_arrays'],
    attributes: { antialias: true, premultipliedAlpha: true, alpha: false },
  }) as any;

  const quadBuf = regl.buffer(QUAD);
  const aBuf = regl.buffer(strokes.a);
  const bBuf = regl.buffer(strokes.b);
  const colBuf = regl.buffer(strokes.color);
  const wBuf = regl.buffer(strokes.width);

  const fillPos = regl.buffer(fills.position);
  const fillCol = regl.buffer(fills.color);

  // single-instance highlight buffers
  const hlA = regl.buffer({ length: 2 * 4, usage: 'dynamic' });
  const hlB = regl.buffer({ length: 2 * 4, usage: 'dynamic' });
  const hlCol = regl.buffer({ length: 3 * 4, usage: 'dynamic' });
  const hlW = regl.buffer({ length: 1 * 4, usage: 'dynamic' });

  const drawStrokes = regl({
    vert: STROKE_VERT,
    frag: STROKE_FRAG,
    attributes: {
      corner: quadBuf,
      aA: { buffer: aBuf, divisor: 1 },
      aB: { buffer: bBuf, divisor: 1 },
      aColor: { buffer: colBuf, divisor: 1 },
      aWidth: { buffer: wBuf, divisor: 1 },
    },
    uniforms: {
      u_center: regl.prop('u_center'),
      u_zoom: regl.prop('u_zoom'),
      u_viewport: regl.prop('u_viewport'),
    },
    depth: { enable: false },
    count: 6,
    instances: regl.prop('instances'),
  });

  const drawHighlight = regl({
    vert: STROKE_VERT,
    frag: STROKE_FRAG,
    attributes: {
      corner: quadBuf,
      aA: { buffer: hlA, divisor: 1 },
      aB: { buffer: hlB, divisor: 1 },
      aColor: { buffer: hlCol, divisor: 1 },
      aWidth: { buffer: hlW, divisor: 1 },
    },
    uniforms: {
      u_center: regl.prop('u_center'),
      u_zoom: regl.prop('u_zoom'),
      u_viewport: regl.prop('u_viewport'),
    },
    depth: { enable: false },
    count: 6,
    instances: 1,
  });

  const drawFills = regl({
    vert: FILL_VERT,
    frag: FILL_FRAG,
    attributes: { position: fillPos, aColor: fillCol },
    uniforms: {
      u_center: regl.prop('u_center'),
      u_zoom: regl.prop('u_zoom'),
      u_viewport: regl.prop('u_viewport'),
    },
    depth: { enable: false },
    blend: {
      enable: true,
      func: { srcRGB: 1, srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' },
    },
    count: fills.count,
  });

  let highlightIdx = -1;

  return {
    regl,
    setHighlight(s, idx) {
      highlightIdx = idx;
      if (idx < 0) return;
      hlA.subdata(new Float32Array([s.a[idx * 2], s.a[idx * 2 + 1]]));
      hlB.subdata(new Float32Array([s.b[idx * 2], s.b[idx * 2 + 1]]));
      hlCol.subdata(new Float32Array([1.0, 1.0, 1.0]));
      hlW.subdata(new Float32Array([4.0]));
    },
    draw(cam, vp, opts) {
      // We drive regl outside regl.frame(), so poll() each draw to sync the GL
      // viewport to the current drawing-buffer size. Without this, regl keeps
      // its stale initial viewport and everything renders into a small
      // bottom-left rectangle.
      regl.poll();
      const u = cameraUniforms(cam, vp);
      regl.clear({ color: [0.11, 0.13, 0.17, 1], depth: 1 });
      if (opts.drawFills) {
        drawFills({ ...u });
      }
      drawStrokes({ ...u, instances: strokes.count });
      if (opts.highlight >= 0 && highlightIdx >= 0) {
        drawHighlight({ ...u });
      }
    },
    destroy() {
      regl.destroy();
    },
  };
}

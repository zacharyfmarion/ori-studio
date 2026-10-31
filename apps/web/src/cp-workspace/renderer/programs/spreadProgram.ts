import type createREGL from 'regl';
import type { Visibility } from '@oristudio/layer-spread';
import type { FillGeometry, StrokeGeometry, ViewTransform, Viewport } from '../types';
import { createStrokeProgram, type StrokeProgram } from './strokeProgram';
import { disposeOnce } from './disposeOnce';
import { spreadInkDepthBias } from './spreadDepth';

type Regl = ReturnType<typeof createREGL>;
type Buffer = ReturnType<Regl['buffer']>;
export interface SpreadFaceGeometry {
  fills: FillGeometry;
  strokes: StrokeGeometry;
}
export interface SpreadGeometry {
  faces: SpreadFaceGeometry[];
  visibility: Visibility;
}
interface Draw {
  view: ViewTransform;
  viewport: Viewport;
  widthPx: number;
}
interface FaceBuffers {
  maskPosition: Buffer;
  maskCount: number;
  blockers: number[];
  position: Buffer;
  color: Buffer;
  depth: Buffer;
  count: number;
  ink: StrokeProgram;
  geometry: SpreadFaceGeometry;
}
interface FillProps extends Draw {
  face: FaceBuffers;
  mask: boolean;
  usePosition?: boolean;
  rank: number;
  bands: number;
}
const VERT = `precision highp float;
attribute vec2 position;attribute vec4 color;attribute float depth;
uniform vec2 origin,ex,ey,viewport;uniform float rank,bands;
varying vec4 ink;
void main(){vec2 p=origin+position.x*ex+position.y*ey;
float d=(rank+0.1+0.8*depth)/bands;
gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,1.0-2.0*d,1.0);ink=color;}`;
const FRAG = `precision highp float;varying vec4 ink;void main(){gl_FragColor=vec4(ink.rgb*ink.a,ink.a);}`;

/** Local-order masks in the existing CP context. No clipping or solver work.
 * The uncorrected pass remains underneath projected cycles which suppress all
 * candidates; normal overlays resume with stencil disabled after this scope.
 */
export function createSpreadProgram(regl: Regl) {
  let faces: FaceBuffers[] = [];
  let order: Visibility | null = null;
  const depthBits = Number(regl._gl.getParameter(regl._gl.DEPTH_BITS)) || 16;
  const drawFill = regl<
    {
      origin: number[];
      ex: number[];
      ey: number[];
      viewport: number[];
      rank: number;
      bands: number;
    },
    { position: unknown; color: unknown; depth: unknown },
    FillProps
  >({
    vert: VERT,
    frag: FRAG,
    attributes: {
      position: (_ctx: unknown, p: FillProps) => p.face.position,
      color: (_ctx: unknown, p: FillProps) => p.face.color,
      depth: (_ctx: unknown, p: FillProps) => p.face.depth,
    },
    uniforms: {
      origin: (_, p) => [...p.view.origin],
      ex: (_, p) => [...p.view.ex],
      ey: (_, p) => [...p.view.ey],
      viewport: (_, p) => [p.viewport.width, p.viewport.height],
      rank: (_, p) => p.rank,
      bands: (_, p) => p.bands,
    },
    count: (_, p) => p.face.count,
    colorMask: (_, p) => (p.mask ? [false, false, false, false] : [true, true, true, true]),
    depth: { enable: true, mask: true, func: 'lequal' },
    blend: {
      enable: true,
      func: { srcRGB: 1, srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' },
    },
  });
  const drawMask = regl<
    { origin: number[]; ex: number[]; ey: number[]; viewport: number[] },
    { position: unknown },
    FillProps
  >({
    vert: `precision highp float;attribute vec2 position;uniform vec2 origin,ex,ey,viewport;
      void main(){vec2 p=origin+position.x*ex+position.y*ey;gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,0.0,1.0);}`,
    frag: `precision highp float;void main(){gl_FragColor=vec4(0.0);}`,
    attributes: { position: (_ctx: unknown, p: FillProps) => (p.usePosition ? p.face.position : p.face.maskPosition) },
    uniforms: {
      origin: (_, p) => [...p.view.origin],
      ex: (_, p) => [...p.view.ex],
      ey: (_, p) => [...p.view.ey],
      viewport: (_, p) => [p.viewport.width, p.viewport.height],
    },
    count: (_, p) => (p.usePosition ? p.face.count : p.face.maskCount),
    colorMask: [false, false, false, false],
    depth: { enable: false, mask: false },
  });
  const mask = regl({
    stencil: {
      enable: true,
      mask: 255,
      func: { cmp: 'always', ref: 1, mask: 255 },
      opFront: { fail: 'keep', zfail: 'keep', zpass: 'replace' },
      opBack: { fail: 'keep', zfail: 'keep', zpass: 'replace' },
    },
  });
  const unmasked = regl({
    stencil: {
      enable: true,
      mask: 0,
      func: { cmp: 'equal', ref: 0, mask: 255 },
      opFront: { fail: 'keep', zfail: 'keep', zpass: 'keep' },
      opBack: { fail: 'keep', zfail: 'keep', zpass: 'keep' },
    },
  });
  const plain = regl({
    stencil: { enable: false, mask: 255 },
    depth: { enable: true, mask: true, func: 'lequal' },
    colorMask: [true, true, true, true],
  });
  const make = (geometry: SpreadFaceGeometry): FaceBuffers => {
    const ink = createStrokeProgram(regl, { depthOrdered: true });
    return {
      maskPosition: regl.buffer([]),
      maskCount: 0,
      blockers: [],
      position: regl.buffer(geometry.fills.position),
      color: regl.buffer(geometry.fills.color),
      depth: regl.buffer(geometry.fills.depth ?? []),
      count: geometry.fills.count,
      ink,
      geometry,
    };
  };
  const destroy = (f: FaceBuffers) => {
    f.maskPosition.destroy();
    f.position.destroy();
    f.color.destroy();
    f.depth.destroy();
    f.ink.dispose();
  };
  function setData(data: SpreadGeometry | null) {
    if (!data) {
      faces.forEach(destroy);
      faces = [];
      order = null;
      return;
    }
    order = data.visibility;
    const bands = order.ranks ? Math.max(...order.ranks) + 1 : 1;
    const inkBias = spreadInkDepthBias(bands, depthBits);
    const boxes = data.faces.map(({ fills }) => {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let k = 0; k < fills.position.length; k += 2) {
        const x = fills.position[k]!,
          y = fills.position[k + 1]!;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return [minX, minY, maxX, maxY];
    });
    let maskBytes = 0;
    while (faces.length > data.faces.length) destroy(faces.pop()!);
    data.faces.forEach((geometry, f) => {
      let target = faces[f];
      if (!target) {
        target = make(geometry);
        faces.push(target);
      } else {
        target.position(geometry.fills.position);
        target.color(geometry.fills.color);
        target.depth(geometry.fills.depth ?? []);
        target.count = geometry.fills.count;
        target.geometry = geometry;
      }
      const rank = order?.ranks?.[f] ?? 0;
      if (!order?.ranks) {
        const a = boxes[f]!;
        const blockers = order!.above[f]!.filter((b) => {
          const box = boxes[b]!;
          return a[0]! <= box[2]! && a[2]! >= box[0]! && a[1]! <= box[3]! && a[3]! >= box[1]!;
        });
        const length = blockers.reduce((n, b) => n + data.faces[b]!.fills.position.length, 0);
        // Dense cyclic graphs must not multiply the mesh into unbounded GPU
        // storage. Above the shared budget, draw the existing blocker buffers.
        if (maskBytes + length * 4 > 64 * 1024 * 1024) {
          target.blockers = blockers;
          target.maskPosition([]);
          target.maskCount = 0;
        } else {
          maskBytes += length * 4;
          target.blockers = [];
          const positions = new Float32Array(length);
          let offset = 0;
          for (const blocker of blockers) {
            const p = data.faces[blocker]!.fills.position;
            positions.set(p, offset);
            offset += p.length;
          }
          target.maskPosition(positions);
          target.maskCount = length / 2;
        }
      }
      const depth = (a: Float32Array | undefined) => a?.map((v) => (rank + 0.1 + 0.8 * v) / bands + inkBias);
      target.ink.setData({
        ...geometry.strokes,
        depth: depth(geometry.strokes.depth),
        depthEnd: depth(geometry.strokes.depthEnd),
      });
    });
  }
  function draw(props: Draw) {
    if (!order) return;
    const ranks = order.ranks,
      bands = ranks ? Math.max(...ranks) + 1 : 1;
    const fill = (f: number, masked = false) =>
      drawFill({ ...props, face: faces[f]!, rank: ranks?.[f] ?? 0, bands, mask: masked });
    const ink = (f: number) => faces[f]!.ink.draw(props);
    plain(() => {
      if (ranks) {
        for (let f = 0; f < faces.length; f++) fill(f);
        for (let f = 0; f < faces.length; f++) ink(f);
        return;
      }
      // Physical baseline, including ink, remains only where the correction
      // offers no surviving face. Clearing depth never clears its colour.
      for (let f = 0; f < faces.length; f++) fill(f);
      for (let f = 0; f < faces.length; f++) ink(f);
      regl.clear({ depth: 1 });
      const corrected = (f: number, paint: () => void) => {
        regl.clear({ stencil: 0 });
        mask(() => {
          const face = faces[f]!;
          if (face.blockers.length)
            for (const b of face.blockers)
              drawMask({ ...props, face: faces[b]!, usePosition: true, rank: 0, bands: 1, mask: true });
          else drawMask({ ...props, face, rank: 0, bands: 1, mask: true });
        });
        unmasked(paint);
      };
      for (let f = 0; f < faces.length; f++) corrected(f, () => fill(f));
      for (let f = 0; f < faces.length; f++) corrected(f, () => ink(f));
    });
  }
  return {
    setData,
    draw,
    dispose: disposeOnce(() => {
      faces.forEach(destroy);
      faces = [];
    }),
  };
}

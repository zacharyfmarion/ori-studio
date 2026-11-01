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

/**
 * How one spread picture sits among whatever else shares its depth buffer.
 *
 * A pane of its own — Fold's, the Diagram's, a capture — owns the whole range
 * ({@link WHOLE_CHANNEL_SPREAD}). Edit's canvas holds many figures, each in
 * its own band of the folded channel (`cpFoldedToScene`), so a spread figure
 * draws inside its band and never clears what the others wrote.
 */
export interface SpreadLayout {
  /** The share of the depth range the picture draws in, `[base, base + span]` of `[0, 1]`, 0 farthest. */
  readonly band: { readonly base: number; readonly span: number };
  /** Multiplies every fill's and line's alpha: a stale figure's fade. */
  readonly opacity: number;
  /**
   * See-through layers (X-ray): every fill at this alpha, back to front in the
   * global order, writing no depth, and every line over all of them. Null for
   * paper, which hides what lies under it.
   */
  readonly xray: { readonly faceAlpha: number } | null;
}

export const WHOLE_CHANNEL_SPREAD: SpreadLayout = { band: { base: 0, span: 1 }, opacity: 1, xray: null };

const sameLayout = (a: SpreadLayout, b: SpreadLayout): boolean =>
  a.band.base === b.band.base &&
  a.band.span === b.band.span &&
  a.opacity === b.opacity &&
  (a.xray?.faceAlpha ?? null) === (b.xray?.faceAlpha ?? null);

const ownsWholeRange = ({ band }: SpreadLayout): boolean => band.base === 0 && band.span === 1;

/**
 * Where a cyclic picture's depth goes back to once its physical baseline is
 * down, inside its band: below the lowest fill (0.1 of a layer) and above
 * every band beneath it.
 */
const RESET_DEPTH = 0.05;

/**
 * One step of a draw. Fills test depth and write it (`write`), paint only the
 * nearest fragment a depth-only pass found (`equal`), test it and write none
 * (`test`), or write depth with no colour (`only`).
 */
export type SpreadPass =
  | { kind: 'fills'; faces: readonly number[]; depth: 'write' | 'equal' | 'test' | 'only' }
  | { kind: 'ink'; faces: readonly number[] }
  /** Forget the physical baseline's depth: the whole buffer, for a picture that owns it. */
  | { kind: 'clear-depth' }
  /** The same inside a band: the picture's own footprint, back to the band's floor. */
  | { kind: 'reset-depth' }
  | { kind: 'corrected-fills' }
  | { kind: 'corrected-ink' };

/**
 * The passes a picture is drawn in, in order. Pure, so what each look and each
 * kind of stack does is pinned without a GL context.
 *
 * - **Paper, acyclic:** fills in their global depth bands, then ink.
 * - **Paper, faded:** a depth-only pass first, so each pixel blends the paper
 *   on top once and the layers under it do not show through.
 * - **Paper, cyclic:** the physical baseline, its depth forgotten, then each
 *   face where none of its direct blockers is (stencil masks). A picture that
 *   owns the depth buffer clears it; one in a band resets only its footprint,
 *   so the figures drawn before it keep theirs. A faded cyclic picture blends
 *   its corrected faces over its baseline, so its buried layers show a little
 *   where the correction repaints.
 * - **X-ray:** fills back to front ({@link spreadXrayOrder}) writing no depth,
 *   then ink over them all, then the fills' depth, so whatever is drawn later
 *   behind the figure stays behind it.
 */
export function spreadDrawPlan(
  visibility: Visibility,
  layout: SpreadLayout,
  faces: readonly number[],
  xrayOrder: readonly number[]
): SpreadPass[] {
  if (layout.xray) {
    return [
      { kind: 'fills', faces: xrayOrder, depth: 'test' },
      { kind: 'ink', faces },
      { kind: 'fills', faces, depth: 'only' },
    ];
  }
  if (visibility.ranks) {
    if (layout.opacity >= 1) return [{ kind: 'fills', faces, depth: 'write' }, { kind: 'ink', faces }];
    return [
      { kind: 'fills', faces, depth: 'only' },
      { kind: 'fills', faces, depth: 'equal' },
      { kind: 'ink', faces },
    ];
  }
  // Physical baseline, including ink, remains only where the correction
  // offers no surviving face. Forgetting depth never forgets its colour.
  // An acyclic graph always leaves a survivor at every covered pixel.
  // Only cycles need a physical baseline underneath the corrected pass.
  const baseline: SpreadPass[] =
    visibility.cyclic !== false
      ? [
          { kind: 'fills', faces, depth: 'write' },
          { kind: 'ink', faces },
          { kind: ownsWholeRange(layout) ? 'clear-depth' : 'reset-depth' },
        ]
      : [];
  return [...baseline, { kind: 'corrected-fills' }, { kind: 'corrected-ink' }];
}

/**
 * X-ray's back-to-front order: by global rank, nearer layers later, and by
 * physical height within a rank. A cyclic stack has no global order, so it
 * goes by physical height alone — each face's mean height over its fill — and
 * where flaps weave the translucent faces blend in that order, not the
 * stack's.
 */
/**
 * Whether a picture lets what lies behind it show: X-ray, or a fade drawn by
 * its depth-only pass. A host that draws other paper on the same depth buffer
 * draws such a picture after that paper, so it blends over what it covers
 * instead of hiding it. A faded cyclic picture is drawn with the paper: its
 * correction needs the depth beneath it to be its own band's.
 */
export function spreadSeesThrough(visibility: Visibility, layout: SpreadLayout): boolean {
  return layout.xray !== null || (layout.opacity < 1 && visibility.ranks !== null);
}

export function spreadXrayOrder(visibility: Visibility, meanDepth: readonly number[]): number[] {
  const rank = (face: number) => visibility.ranks?.[face] ?? 0;
  return meanDepth
    .map((_, face) => face)
    .sort((a, b) => rank(a) - rank(b) || meanDepth[a]! - meanDepth[b]! || a - b);
}

/**
 * The view a picture is drawn through: `view` after the picture's own
 * placement in user space, a uniform scale and then a shift. A move or a
 * resize only changes this, never the uploaded geometry.
 */
export function placedSpreadView(
  view: ViewTransform,
  placement: { readonly scale: number; readonly x: number; readonly y: number }
): ViewTransform {
  const { origin, ex, ey } = view;
  const { scale, x, y } = placement;
  return {
    origin: [origin[0] + x * ex[0] + y * ey[0], origin[1] + x * ex[1] + y * ey[1]],
    ex: [scale * ex[0], scale * ex[1]],
    ey: [scale * ey[0], scale * ey[1]],
  };
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
type DepthFunc = 'lequal' | 'equal' | 'always';
interface FillProps extends Draw {
  face: FaceBuffers;
  usePosition?: boolean;
  rank: number;
  bands: number;
  base: number;
  span: number;
  alpha: number;
  color: boolean;
  depthWrite: boolean;
  depthFunc: DepthFunc;
}
const VERT = `precision highp float;
attribute vec2 position;attribute vec4 color;attribute float depth;
uniform vec2 origin,ex,ey,viewport;uniform float rank,bands,base,span,alpha;
varying vec4 ink;
void main(){vec2 p=origin+position.x*ex+position.y*ey;
float d=base+span*((rank+0.1+0.8*depth)/bands);
gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,1.0-2.0*d,1.0);ink=vec4(color.rgb,color.a*alpha);}`;
const FRAG = `precision highp float;varying vec4 ink;void main(){gl_FragColor=vec4(ink.rgb*ink.a,ink.a);}`;

/** Global depth bands in the existing CP context. No clipping or solver work.
 * Only genuinely cyclic stacks need local-order masks.
 * The uncorrected pass remains underneath projected cycles which suppress all
 * candidates; normal overlays resume with stencil disabled after this scope.
 *
 * `setData` with the geometry it already holds uploads nothing, and with a new
 * layout only re-uploads the lines (their depth and alpha are baked in): a host
 * that hands over every figure on every frame of a drag pays nothing for the
 * spread figures that did not change.
 */
export function createSpreadProgram(regl: Regl) {
  let faces: FaceBuffers[] = [];
  let order: Visibility | null = null;
  let held: SpreadGeometry | null = null;
  let layout: SpreadLayout = WHOLE_CHANNEL_SPREAD;
  let bands = 1;
  let all: number[] = [];
  let xrayOrder: number[] = [];
  let plan: SpreadPass[] = [];
  const depthBits = Number(regl._gl.getParameter(regl._gl.DEPTH_BITS)) || 16;
  // One command per depth mode; they share the compiled program.
  const fillCommand = (mask: boolean, func: DepthFunc) =>
    regl<
      {
        origin: number[];
        ex: number[];
        ey: number[];
        viewport: number[];
        rank: number;
        bands: number;
        base: number;
        span: number;
        alpha: number;
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
        base: (_, p) => p.base,
        span: (_, p) => p.span,
        alpha: (_, p) => p.alpha,
      },
      count: (_, p) => p.face.count,
      colorMask: (_, p) => (p.color ? [true, true, true, true] : [false, false, false, false]),
      depth: { enable: true, mask, func },
      blend: {
        enable: true,
        func: { srcRGB: 1, srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' },
      },
    });
  const fills = {
    write: fillCommand(true, 'lequal'),
    test: fillCommand(false, 'lequal'),
    equal: fillCommand(false, 'equal'),
    always: fillCommand(true, 'always'),
  };
  const drawFill = (props: FillProps) =>
    (props.depthFunc === 'always'
      ? fills.always
      : props.depthFunc === 'equal'
        ? fills.equal
        : props.depthWrite
          ? fills.write
          : fills.test)(props);
  const drawMask = regl<
    { origin: number[]; ex: number[]; ey: number[]; viewport: number[] },
    { position: unknown },
    Pick<FillProps, 'face' | 'usePosition' | 'view' | 'viewport'>
  >({
    vert: `precision highp float;attribute vec2 position;uniform vec2 origin,ex,ey,viewport;
      void main(){vec2 p=origin+position.x*ex+position.y*ey;gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,0.0,1.0);}`,
    frag: `precision highp float;void main(){gl_FragColor=vec4(0.0);}`,
    attributes: {
      position: (_ctx: unknown, p: Pick<FillProps, 'face' | 'usePosition'>) =>
        p.usePosition ? p.face.position : p.face.maskPosition,
    },
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
  /** The lines carry their depth and alpha per segment, so a band or a fade is baked in here. */
  function uploadInk() {
    const { base, span } = layout.band;
    const inkBias = spreadInkDepthBias(bands, depthBits, span);
    faces.forEach((target, f) => {
      const { strokes } = target.geometry;
      const rank = order?.ranks?.[f] ?? 0;
      const depth = (a: Float32Array | undefined) =>
        a?.map((v) => base + span * ((rank + 0.1 + 0.8 * v) / bands) + inkBias);
      const opacity = layout.opacity;
      target.ink.setData({
        ...strokes,
        ...(opacity < 1 ? { color: strokes.color.map((v, k) => (k % 4 === 3 ? v * opacity : v)) } : {}),
        depth: depth(strokes.depth),
        depthEnd: depth(strokes.depthEnd),
      });
    });
  }
  function setData(data: SpreadGeometry | null, next: SpreadLayout = WHOLE_CHANNEL_SPREAD) {
    if (!data) {
      faces.forEach(destroy);
      faces = [];
      order = null;
      held = null;
      plan = [];
      return;
    }
    if (data === held) {
      if (sameLayout(next, layout)) return;
      layout = next;
      plan = spreadDrawPlan(data.visibility, layout, all, xrayOrder);
      uploadInk();
      return;
    }
    held = data;
    layout = next;
    order = data.visibility;
    bands = order.ranks ? Math.max(...order.ranks) + 1 : 1;
    const boxes = order.ranks ? [] : data.faces.map(({ fills }) => {
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
      if (order?.ranks) {
        // Release any buffers retained from a previously cyclic scene.
        if (target.maskCount || target.blockers.length) {
          target.maskPosition([]);
          target.maskCount = 0;
          target.blockers = [];
        }
      } else {
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
    });
    all = data.faces.map((_, f) => f);
    xrayOrder = spreadXrayOrder(
      order,
      data.faces.map(({ fills }) => {
        const depth = fills.depth;
        if (!depth?.length) return 0;
        let sum = 0;
        for (const v of depth) sum += v;
        return sum / depth.length;
      })
    );
    plan = spreadDrawPlan(order, layout, all, xrayOrder);
    uploadInk();
  }
  function draw(props: Draw) {
    if (!order) return;
    const ranks = order.ranks;
    const { base, span } = layout.band;
    const alpha = layout.opacity;
    const fill = (f: number, depth: 'write' | 'equal' | 'test' | 'only') =>
      drawFill({
        ...props,
        face: faces[f]!,
        rank: ranks?.[f] ?? 0,
        bands,
        base,
        span,
        alpha: depth === 'test' ? (layout.xray?.faceAlpha ?? 1) * alpha : alpha,
        color: depth !== 'only',
        depthWrite: depth === 'write' || depth === 'only',
        depthFunc: depth === 'equal' ? 'equal' : 'lequal',
      });
    const ink = (f: number) => faces[f]!.ink.draw(props);
    const corrected = (f: number, paint: () => void) => {
      regl.clear({ stencil: 0 });
      mask(() => {
        const face = faces[f]!;
        if (face.blockers.length)
          for (const b of face.blockers) drawMask({ ...props, face: faces[b]!, usePosition: true });
        else drawMask({ ...props, face });
      });
      unmasked(paint);
    };
    plain(() => {
      for (const pass of plan) {
        switch (pass.kind) {
          case 'fills':
            for (const f of pass.faces) fill(f, pass.depth);
            break;
          case 'ink':
            for (const f of pass.faces) ink(f);
            break;
          case 'clear-depth':
            regl.clear({ depth: 1 });
            break;
          case 'reset-depth':
            // Every face's fill at one depth, the band's floor: what the
            // baseline wrote is forgotten, and what lies outside this figure
            // is left as the figures drawn before it wrote it.
            for (let f = 0; f < faces.length; f++)
              drawFill({
                ...props,
                face: faces[f]!,
                rank: 0,
                bands: 1,
                base: base + span * RESET_DEPTH,
                span: 0,
                alpha: 0,
                color: false,
                depthWrite: true,
                depthFunc: 'always',
              });
            break;
          case 'corrected-fills':
            for (let f = 0; f < faces.length; f++) corrected(f, () => fill(f, 'write'));
            break;
          case 'corrected-ink':
            for (let f = 0; f < faces.length; f++) corrected(f, () => ink(f));
            break;
        }
      }
    });
  }
  return {
    setData,
    draw,
    /** {@link spreadSeesThrough} for the picture and layout held; false while there is none. */
    seesThrough: () => (order ? spreadSeesThrough(order, layout) : false),
    dispose: disposeOnce(() => {
      faces.forEach(destroy);
      faces = [];
    }),
  };
}

export type SpreadProgram = ReturnType<typeof createSpreadProgram>;

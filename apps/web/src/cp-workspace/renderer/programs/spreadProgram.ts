import type createREGL from 'regl';
import type { Visibility } from '@oristudio/layer-spread';
import { MAX_DASH_SLOTS, type FillGeometry, type StrokeGeometry, type ViewTransform, type Viewport } from '../types';
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

/**
 * Faces' fills in one set of buffers, one face's run of vertices after
 * another: a whole picture is one draw, and a face alone a range of it. The
 * face's rank rides on each vertex, so one draw sorts every face into its
 * depth band as a draw per face did.
 */
interface FillRun {
  position: Buffer;
  color: Buffer;
  depth: Buffer;
  rank: Buffer;
  count: number;
}

/** A face's run of vertices in the face-order {@link FillRun}. */
interface FaceRange {
  first: number;
  count: number;
}

/**
 * A cyclic picture's stencil mask for one face: its blockers' fills, as its
 * run of the picture's one mask buffer, or — past the budget — as the
 * blockers' own ranges of the face-order fills.
 */
interface FaceMask {
  first: number;
  count: number;
  blockers: number[];
}

/** What a masked step is drawn with: the stencil value its face's mask is written with. */
interface StencilRef {
  ref: number;
}

/**
 * `stencil.func` comparing with the step's own value. regl reads a function
 * given there on every draw, which its types do not allow for.
 */
function stencilFuncWithRef(cmp: 'always' | 'notequal'): createREGL.StencilFunction {
  const func = (_ctx: unknown, { ref }: StencilRef) => ({ cmp, ref, mask: 255 });
  return func as unknown as createREGL.StencilFunction;
}

type DepthFunc = 'lequal' | 'equal' | 'always';
interface FillProps extends Draw {
  run: FillRun;
  first: number;
  count: number;
  bands: number;
  base: number;
  span: number;
  alpha: number;
  color: boolean;
  depthWrite: boolean;
  depthFunc: DepthFunc;
}
interface MaskProps extends Draw {
  position: Buffer;
  first: number;
  count: number;
}
const VERT = `precision highp float;
attribute vec2 position;attribute vec4 color;attribute float depth;attribute float rank;
uniform vec2 origin,ex,ey,viewport;uniform float bands,base,span,alpha;
varying vec4 ink;
void main(){vec2 p=origin+position.x*ex+position.y*ey;
float d=base+span*((rank+0.1+0.8*depth)/bands);
gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,1.0-2.0*d,1.0);ink=vec4(color.rgb,color.a*alpha);}`;
const FRAG = `precision highp float;varying vec4 ink;void main(){gl_FragColor=vec4(ink.rgb*ink.a,ink.a);}`;

/**
 * Every face's lines as one geometry, in face order, so the picture's ink is
 * one draw. Each face numbers its own dash patterns, so the tables are joined
 * and each face's slots renumbered into the join. Null when the join needs
 * more slots than the stroke program has: the faces then draw their own.
 */
export function mergedSpreadInk(lines: readonly StrokeGeometry[]): StrokeGeometry | null {
  const table: (readonly number[])[] = [];
  const slotOf = new Map<string, number>();
  const remap = lines.map((line) =>
    (line.dashPatterns ?? []).map((pattern) => {
      const key = pattern.join(',');
      let slot = slotOf.get(key);
      if (slot === undefined) {
        table.push(pattern);
        slot = table.length;
        slotOf.set(key, slot);
      }
      return slot;
    })
  );
  if (table.length > MAX_DASH_SLOTS) return null;
  const count = lines.reduce((total, line) => total + line.count, 0);
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count);
  const depth = new Float32Array(count);
  const depthEnd = new Float32Array(count);
  const dashSlot = new Float32Array(count);
  const dashPhase = new Float32Array(count);
  let at = 0;
  lines.forEach((line, f) => {
    const n = line.count;
    a.set(line.a.subarray(0, n * 2), at * 2);
    b.set(line.b.subarray(0, n * 2), at * 2);
    color.set(line.color.subarray(0, n * 4), at * 4);
    widthMul.set(line.widthMul.subarray(0, n), at);
    if (line.depth) depth.set(line.depth.subarray(0, n), at);
    const end = line.depthEnd ?? line.depth;
    if (end) depthEnd.set(end.subarray(0, n), at);
    const slots = remap[f]!;
    if (line.dashSlot) {
      for (let k = 0; k < n; k++) {
        const slot = Math.round(line.dashSlot[k]!);
        dashSlot[at + k] = slot > 0 ? (slots[slot - 1] ?? 0) : 0;
      }
    } else if (slots.length) {
      // A face with a table and no slots dashes every line with its first pattern.
      dashSlot.fill(slots[0]!, at, at + n);
    }
    if (line.dashPhase) dashPhase.set(line.dashPhase.subarray(0, n), at);
    at += n;
  });
  return {
    a,
    b,
    color,
    widthMul,
    depth,
    depthEnd,
    count,
    ...(table.length ? { dashPatterns: table, dashSlot, dashPhase } : {}),
  };
}

/** Global depth bands in the existing CP context. No clipping or solver work.
 * Only genuinely cyclic stacks need local-order masks.
 * The uncorrected pass remains underneath projected cycles which suppress all
 * candidates; normal overlays resume with stencil disabled after this scope.
 *
 * A pass over every face is one draw of the fills and one of the lines, so a
 * picture's cost per frame does not grow with its faces: a canvas of many
 * spread figures re-draws as it pans. Only a cyclic picture's corrected
 * passes go face by face, as their stencil masks need.
 *
 * `setData` with the geometry it already holds uploads nothing, and with a new
 * layout only re-uploads the lines (their depth and alpha are baked in): a host
 * that hands over every figure on every frame of a drag pays nothing for the
 * spread figures that did not change.
 */
export function createSpreadProgram(regl: Regl) {
  let order: Visibility | null = null;
  let held: SpreadGeometry | null = null;
  let layout: SpreadLayout = WHOLE_CHANNEL_SPREAD;
  let bands = 1;
  let all: number[] = [];
  let xrayOrder: number[] = [];
  let plan: SpreadPass[] = [];
  // The fills in face order, and each face's range in them.
  let byFace: FillRun | null = null;
  let ranges: FaceRange[] = [];
  // The fills in X-ray's back-to-front order: made the first time X-ray draws.
  let byXray: FillRun | null = null;
  let xrayStale = true;
  // Each face's lines with its band and fade baked in, every face's in one
  // program, and each face's range of it, for a cyclic picture's corrected pass.
  let lines: StrokeGeometry[] = [];
  let ink: StrokeProgram | null = null;
  let inkRanges: FaceRange[] = [];
  // A face's own lines, for the corrected pass when they cannot join one
  // program (`mergedSpreadInk`): made when first drawn.
  let faceInk: (StrokeProgram | undefined)[] = [];
  let masks: FaceMask[] = [];
  let maskRun: Buffer | null = null;
  const depthBits = Number(regl._gl.getParameter(regl._gl.DEPTH_BITS)) || 16;
  // The values a face's mask can be written with before the stencil must be cleared.
  const stencilValues = 2 ** Math.min(Number(regl._gl.getParameter(regl._gl.STENCIL_BITS)) || 8, 8) - 1;
  // One command per depth mode; they share the compiled program.
  const fillCommand = (mask: boolean, func: DepthFunc) =>
    regl<
      {
        origin: number[];
        ex: number[];
        ey: number[];
        viewport: number[];
        bands: number;
        base: number;
        span: number;
        alpha: number;
      },
      { position: unknown; color: unknown; depth: unknown; rank: unknown },
      FillProps
    >({
      vert: VERT,
      frag: FRAG,
      attributes: {
        position: (_ctx: unknown, p: FillProps) => p.run.position,
        color: (_ctx: unknown, p: FillProps) => p.run.color,
        depth: (_ctx: unknown, p: FillProps) => p.run.depth,
        rank: (_ctx: unknown, p: FillProps) => p.run.rank,
      },
      uniforms: {
        origin: (_, p) => [...p.view.origin],
        ex: (_, p) => [...p.view.ex],
        ey: (_, p) => [...p.view.ey],
        viewport: (_, p) => [p.viewport.width, p.viewport.height],
        bands: (_, p) => p.bands,
        base: (_, p) => p.base,
        span: (_, p) => p.span,
        alpha: (_, p) => p.alpha,
      },
      offset: (_, p) => p.first,
      count: (_, p) => p.count,
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
  const drawFill = (props: FillProps) => {
    if (props.count === 0) return;
    (props.depthFunc === 'always'
      ? fills.always
      : props.depthFunc === 'equal'
        ? fills.equal
        : props.depthWrite
          ? fills.write
          : fills.test)(props);
  };
  const maskCommand = regl<
    { origin: number[]; ex: number[]; ey: number[]; viewport: number[] },
    { position: unknown },
    MaskProps
  >({
    vert: `precision highp float;attribute vec2 position;uniform vec2 origin,ex,ey,viewport;
      void main(){vec2 p=origin+position.x*ex+position.y*ey;gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,0.0,1.0);}`,
    frag: `precision highp float;void main(){gl_FragColor=vec4(0.0);}`,
    attributes: {
      position: (_ctx: unknown, p: MaskProps) => p.position,
    },
    uniforms: {
      origin: (_, p) => [...p.view.origin],
      ex: (_, p) => [...p.view.ex],
      ey: (_, p) => [...p.view.ey],
      viewport: (_, p) => [p.viewport.width, p.viewport.height],
    },
    offset: (_, p) => p.first,
    count: (_, p) => p.count,
    colorMask: [false, false, false, false],
    depth: { enable: false, mask: false },
  });
  const drawMask = (props: MaskProps) => {
    if (props.count > 0) maskCommand(props);
  };
  // A face's mask writes its own value, and its paint passes wherever the
  // stencil holds any other: the masks drawn before it, with other values,
  // never mask it, so none of them has to be cleared away first.
  const mask = regl<Record<string, never>, Record<string, never>, StencilRef>({
    stencil: {
      enable: true,
      mask: 255,
      func: stencilFuncWithRef('always'),
      opFront: { fail: 'keep', zfail: 'keep', zpass: 'replace' },
      opBack: { fail: 'keep', zfail: 'keep', zpass: 'replace' },
    },
  });
  const unmasked = regl<Record<string, never>, Record<string, never>, StencilRef>({
    stencil: {
      enable: true,
      mask: 0,
      func: stencilFuncWithRef('notequal'),
      opFront: { fail: 'keep', zfail: 'keep', zpass: 'keep' },
      opBack: { fail: 'keep', zfail: 'keep', zpass: 'keep' },
    },
  });
  const plain = regl({
    stencil: { enable: false, mask: 255 },
    depth: { enable: true, mask: true, func: 'lequal' },
    colorMask: [true, true, true, true],
  });
  const emptyRun = (): FillRun => ({
    position: regl.buffer([]),
    color: regl.buffer([]),
    depth: regl.buffer([]),
    rank: regl.buffer([]),
    count: 0,
  });
  const destroyRun = (run: FillRun | null) => {
    run?.position.destroy();
    run?.color.destroy();
    run?.depth.destroy();
    run?.rank.destroy();
  };
  /** Fill `run` with the faces of `data` in the order given; returns where each landed. */
  function upload(run: FillRun, data: SpreadGeometry, faceOrder: readonly number[]): FaceRange[] {
    let count = 0;
    for (const f of faceOrder) count += data.faces[f]!.fills.count;
    const position = new Float32Array(count * 2);
    const color = new Float32Array(count * 4);
    const depth = new Float32Array(count);
    const rank = new Float32Array(count);
    const placed: FaceRange[] = [];
    let at = 0;
    for (const f of faceOrder) {
      const { fills: face } = data.faces[f]!;
      const n = face.count;
      position.set(face.position.subarray(0, n * 2), at * 2);
      color.set(face.color.subarray(0, n * 4), at * 4);
      if (face.depth) depth.set(face.depth.subarray(0, n), at);
      rank.fill(order?.ranks?.[f] ?? 0, at, at + n);
      placed[f] = { first: at, count: n };
      at += n;
    }
    run.position(position);
    run.color(color);
    run.depth(depth);
    run.rank(rank);
    run.count = count;
    return placed;
  }
  const disposeFaceInk = () => {
    for (const program of faceInk) program?.dispose();
    faceInk = [];
  };
  /** The lines carry their depth and alpha per segment, so a band or a fade is baked in here. */
  function uploadInk() {
    if (!held) return;
    const { base, span } = layout.band;
    const inkBias = spreadInkDepthBias(bands, depthBits, span);
    const opacity = layout.opacity;
    lines = held.faces.map(({ strokes }, f) => {
      const rank = order?.ranks?.[f] ?? 0;
      const depth = (a: Float32Array | undefined) =>
        a?.map((v) => base + span * ((rank + 0.1 + 0.8 * v) / bands) + inkBias);
      return {
        ...strokes,
        ...(opacity < 1 ? { color: strokes.color.map((v, k) => (k % 4 === 3 ? v * opacity : v)) } : {}),
        depth: depth(strokes.depth),
        depthEnd: depth(strokes.depthEnd),
      };
    });
    const merged = mergedSpreadInk(lines);
    if (merged) {
      ink ??= createStrokeProgram(regl, { depthOrdered: true });
      ink.setData(merged);
      let first = 0;
      inkRanges = lines.map(({ count }) => {
        const range = { first, count };
        first += count;
        return range;
      });
      disposeFaceInk();
    } else {
      ink?.dispose();
      ink = null;
      inkRanges = [];
      faceInk.forEach((program, f) => program?.setData(lines[f]!));
    }
  }
  /** One face's lines: its range of the picture's ink, or its own program when they could not join it. */
  function drawFaceInk(f: number, props: Draw) {
    if (ink) {
      ink.draw(props, inkRanges[f]);
      return;
    }
    let program = faceInk[f];
    if (!program) {
      program = createStrokeProgram(regl, { depthOrdered: true });
      program.setData(lines[f]!);
      faceInk[f] = program;
    }
    program.draw(props);
  }
  function xrayRun(): FillRun {
    byXray ??= emptyRun();
    if (xrayStale && held) {
      upload(byXray, held, xrayOrder);
      xrayStale = false;
    }
    return byXray;
  }
  function release() {
    destroyRun(byFace);
    destroyRun(byXray);
    byFace = null;
    byXray = null;
    xrayStale = true;
    ranges = [];
    ink?.dispose();
    ink = null;
    inkRanges = [];
    disposeFaceInk();
    maskRun?.destroy();
    maskRun = null;
    masks = [];
    lines = [];
  }
  function setData(data: SpreadGeometry | null, next: SpreadLayout = WHOLE_CHANNEL_SPREAD) {
    if (!data) {
      release();
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
    byFace ??= emptyRun();
    ranges = upload(byFace, data, all);
    xrayStale = true;
    disposeFaceInk();
    masks = [];
    if (!order.ranks) {
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
      // Every face's mask, one after another, in one buffer: one upload for
      // the picture, where a buffer per face made each new spread — every
      // step of an Amount drag — create and fill hundreds of them.
      let maskLength = 0;
      // The blockers each face's run of the buffer is made of.
      const inBuffer: number[][] = [];
      masks = data.faces.map((_, f) => {
        const a = boxes[f]!;
        const blockers = order!.above[f]!.filter((b) => {
          const box = boxes[b]!;
          return a[0]! <= box[2]! && a[2]! >= box[0]! && a[1]! <= box[3]! && a[3]! >= box[1]!;
        });
        const length = blockers.reduce((n, b) => n + data.faces[b]!.fills.position.length, 0);
        // Dense cyclic graphs must not multiply the mesh into unbounded GPU
        // storage. Above the shared budget, draw the blockers' own ranges.
        if ((maskLength + length) * 4 > 64 * 1024 * 1024) return { first: 0, count: 0, blockers };
        inBuffer[f] = blockers;
        const mask = { first: maskLength / 2, count: length / 2, blockers: [] };
        maskLength += length;
        return mask;
      });
      const positions = new Float32Array(maskLength);
      masks.forEach(({ first }, f) => {
        let offset = first * 2;
        for (const blocker of inBuffer[f] ?? []) {
          const p = data.faces[blocker]!.fills.position;
          positions.set(p, offset);
          offset += p.length;
        }
      });
      maskRun ??= regl.buffer([]);
      maskRun(positions);
    }
    plan = spreadDrawPlan(order, layout, all, xrayOrder);
    uploadInk();
  }
  function draw(props: Draw) {
    if (!order || !byFace) return;
    const faceRun = byFace;
    const { base, span } = layout.band;
    const alpha = layout.opacity;
    const paint = (run: FillRun, first: number, count: number, depth: 'write' | 'equal' | 'test' | 'only') =>
      drawFill({
        ...props,
        run,
        first,
        count,
        bands,
        base,
        span,
        alpha: depth === 'test' ? (layout.xray?.faceAlpha ?? 1) * alpha : alpha,
        color: depth !== 'only',
        depthWrite: depth === 'write' || depth === 'only',
        depthFunc: depth === 'equal' ? 'equal' : 'lequal',
      });
    const paintFaces = (faces: readonly number[], depth: 'write' | 'equal' | 'test' | 'only') => {
      if (faces === all) paint(faceRun, 0, faceRun.count, depth);
      else if (faces === xrayOrder) {
        const run = xrayRun();
        paint(run, 0, run.count, depth);
      } else for (const f of faces) paint(faceRun, ranges[f]!.first, ranges[f]!.count, depth);
    };
    const inkFaces = (faces: readonly number[]) => {
      if (faces === all && ink) ink.draw(props);
      else for (const f of faces) drawFaceInk(f, props);
    };
    // Each face's mask gets a stencil value of its own, so the stencil is
    // cleared before the first and then only when the values run out, not
    // once per face: a clear per face was most of a cyclic picture's frame in
    // WebKit. Other pictures write the stencil too, so each draw starts afresh.
    let ref = stencilValues;
    const corrected = (f: number, paintFace: () => void) => {
      if (ref === stencilValues) {
        regl.clear({ stencil: 0 });
        ref = 0;
      }
      ref += 1;
      mask({ ref }, () => {
        const face = masks[f]!;
        if (face.blockers.length)
          for (const b of face.blockers)
            drawMask({ ...props, position: faceRun.position, first: ranges[b]!.first, count: ranges[b]!.count });
        else drawMask({ ...props, position: maskRun!, first: face.first, count: face.count });
      });
      unmasked({ ref }, paintFace);
    };
    plain(() => {
      for (const pass of plan) {
        switch (pass.kind) {
          case 'fills':
            paintFaces(pass.faces, pass.depth);
            break;
          case 'ink':
            inkFaces(pass.faces);
            break;
          case 'clear-depth':
            regl.clear({ depth: 1 });
            break;
          case 'reset-depth':
            // Every face's fill at one depth, the band's floor: what the
            // baseline wrote is forgotten, and what lies outside this figure
            // is left as the figures drawn before it wrote it.
            drawFill({
              ...props,
              run: faceRun,
              first: 0,
              count: faceRun.count,
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
            for (const f of all) corrected(f, () => paint(faceRun, ranges[f]!.first, ranges[f]!.count, 'write'));
            break;
          case 'corrected-ink':
            for (const f of all) corrected(f, () => drawFaceInk(f, props));
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
      release();
      order = null;
      held = null;
    }),
  };
}

export type SpreadProgram = ReturnType<typeof createSpreadProgram>;

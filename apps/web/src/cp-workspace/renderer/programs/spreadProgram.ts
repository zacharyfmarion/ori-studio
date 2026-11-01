import type createREGL from 'regl';
import type { Visibility } from '@oristudio/layer-spread';
import {
  MAX_DASH_SLOTS,
  type FillGeometry,
  type ScissorBox,
  type StrokeGeometry,
  type ViewTransform,
  type Viewport,
} from '../types';
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

/** A box in the picture's coordinates: min x, min y, max x, max y. */
type PictureBox = readonly [number, number, number, number];

/** The box around `count` points of a flat x, y array; empty (min above max) when there are none. */
function boxOf(xy: ArrayLike<number>, count = xy.length / 2): PictureBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let k = 0; k < count * 2; k += 2) {
    const x = xy[k]!,
      y = xy[k + 1]!;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Where a box of the picture lands on the drawing buffer through `view`,
 * `pad` device px wider all round, as a scissor rectangle; null when none of
 * it is on the buffer.
 */
export function scissorOnBuffer(box: PictureBox, view: ViewTransform, viewport: Viewport, pad: number): ScissorBox | null {
  const [x0, y0, x1, y1] = box;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as const) {
    const px = view.origin[0] + x * view.ex[0] + y * view.ey[0];
    const py = view.origin[1] + x * view.ex[1] + y * view.ey[1];
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const left = Math.max(0, Math.floor(minX - pad));
  const right = Math.min(viewport.width, Math.ceil(maxX + pad));
  const top = Math.max(0, Math.floor(minY - pad));
  const bottom = Math.min(viewport.height, Math.ceil(maxY + pad));
  if (!(right > left && bottom > top)) return null;
  // Device px run down from the top; the scissor runs up from the bottom.
  return { x: left, y: viewport.height - bottom, width: right - left, height: bottom - top };
}

/** The smallest scissor rectangle holding all of `boxes`. */
function scissorUnion(boxes: readonly ScissorBox[]): ScissorBox {
  const left = Math.min(...boxes.map(({ x }) => x));
  const bottom = Math.min(...boxes.map(({ y }) => y));
  const right = Math.max(...boxes.map(({ x, width }) => x + width));
  const top = Math.max(...boxes.map(({ y, height }) => y + height));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
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

/**
 * How many faces a cyclic picture's corrected pass draws together, one
 * stencil bit each: their masks stand side by side, so the masks go in one
 * batch and the faces in another.
 */
const SPREAD_LANES = 8;

/** A corrected face's stencil test: drawn where its bit is clear, and only inside `box`. */
interface StencilLane {
  stencilBit: number;
  box: ScissorBox;
}

/**
 * A stencil field read from each draw's props. regl evaluates a function
 * nested in `stencil` on every draw, batches included; its types do not
 * allow one there.
 */
function perDraw<P, T>(read: (props: P) => T): T {
  return ((_ctx: unknown, props: P) => read(props)) as unknown as T;
}

/** The scissor to each item's `box`. */
function scissorToBox(): createREGL.ScissorOptions {
  return { enable: true, box: perDraw((p: { box: ScissorBox }) => p.box) };
}

/** The stencil state that draws only where the item's `stencilBit` is clear, writing none. */
function laneTest(): createREGL.StencilOptions {
  return {
    enable: true,
    mask: 0,
    func: perDraw((p: StencilLane) => ({ cmp: 'equal' as const, ref: 0, mask: p.stencilBit })),
    opFront: { fail: 'keep', zfail: 'keep', zpass: 'keep' },
    opBack: { fail: 'keep', zfail: 'keep', zpass: 'keep' },
  };
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
  /** For a corrected face's fill: its stencil bit, and where it can draw. */
  stencilBit?: number;
  box?: ScissorBox;
}
interface MaskProps extends Draw {
  position: Buffer;
  first: number;
  count: number;
  /** Written into the `writeMask` bits where the mask's triangles fall, inside `box`. */
  ref: number;
  writeMask: number;
  box: ScissorBox;
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

/**
 * Two triangles over every face's box, as mask positions: everywhere a
 * cyclic picture's masks can fall, so drawing them puts the picture's stencil
 * back to 0. Empty when no face has a fill.
 */
export function footprintTriangles(boxes: readonly (readonly number[])[]): Float32Array {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x0, y0, x1, y1] of boxes) {
    minX = Math.min(minX, x0!);
    minY = Math.min(minY, y0!);
    maxX = Math.max(maxX, x1!);
    maxY = Math.max(maxY, y1!);
  }
  if (!(minX <= maxX && minY <= maxY)) return new Float32Array(0);
  // A margin, so a mask edge on the box's edge is covered however it rounds.
  const pad = Math.max(maxX - minX, maxY - minY, 1) * 0.01;
  [minX, minY, maxX, maxY] = [minX - pad, minY - pad, maxX + pad, maxY + pad];
  return new Float32Array([minX, minY, maxX, minY, maxX, maxY, minX, minY, maxX, maxY, minX, maxY]);
}

/** Global depth bands in the existing CP context. No clipping or solver work.
 * Only genuinely cyclic stacks need local-order masks.
 * The uncorrected pass remains underneath projected cycles which suppress all
 * candidates; normal overlays resume with stencil disabled after this scope.
 *
 * A pass over every face is one draw of the fills and one of the lines, so a
 * picture's cost per frame does not grow with its faces: a canvas of many
 * spread figures re-draws as it pans. Only a cyclic picture's corrected
 * passes go face by face, as their stencil masks need: a mask and a draw a
 * face, in batches of eight, each face's mask in a stencil bit of its own.
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
  // A cyclic picture's faces' boxes, for the corrected passes to leave out
  // the faces off the drawing buffer and scissor the rest: each face's fills,
  // and its lines with the widest pen among them.
  let fillBoxes: PictureBox[] = [];
  let inkBoxes: PictureBox[] = [];
  let inkWidths: number[] = [];
  // The vertices the mask buffer opens with: the picture's footprint.
  let footprintCount = 0;
  const depthBits = Number(regl._gl.getParameter(regl._gl.DEPTH_BITS)) || 16;
  // A corrected chunk's faces, one stencil bit each.
  const lanes = Math.max(1, Math.min(SPREAD_LANES, Number(regl._gl.getParameter(regl._gl.STENCIL_BITS)) || 8));
  // One command per depth mode, and one for a corrected face's fill, tested
  // against its stencil bit; they share the compiled program.
  const fillCommand = (mask: boolean, func: DepthFunc, laneTested = false) =>
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
      ...(laneTested ? { stencil: laneTest(), scissor: scissorToBox() } : {}),
    });
  const fills = {
    write: fillCommand(true, 'lequal'),
    test: fillCommand(false, 'lequal'),
    equal: fillCommand(false, 'equal'),
    always: fillCommand(true, 'always'),
    corrected: fillCommand(true, 'lequal', true),
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
    scissor: scissorToBox(),
    stencil: {
      enable: true,
      mask: perDraw((p: MaskProps) => p.writeMask),
      func: perDraw((p: MaskProps) => ({ cmp: 'always' as const, ref: p.ref, mask: 255 })),
      opFront: { fail: 'keep', zfail: 'keep', zpass: 'replace' },
      opBack: { fail: 'keep', zfail: 'keep', zpass: 'replace' },
    },
  });
  // A face's lines alone, against its stencil bit, when they could not join the picture's ink program.
  const laneTested = regl<Record<string, never>, Record<string, never>, StencilLane>({
    stencil: laneTest(),
    scissor: scissorToBox(),
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
    if (!order?.ranks) {
      inkBoxes = lines.map(({ a, b, count }) => {
        const [ax0, ay0, ax1, ay1] = boxOf(a, count);
        const [bx0, by0, bx1, by1] = boxOf(b, count);
        return [Math.min(ax0, bx0), Math.min(ay0, by0), Math.max(ax1, bx1), Math.max(ay1, by1)] as const;
      });
      inkWidths = lines.map(({ widthMul, count }) => {
        let widest = 0;
        for (let k = 0; k < count; k++) widest = Math.max(widest, widthMul[k]!);
        return widest;
      });
    }
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
  function faceInkOf(f: number): StrokeProgram {
    let program = faceInk[f];
    if (!program) {
      program = createStrokeProgram(regl, { depthOrdered: true });
      program.setData(lines[f]!);
      faceInk[f] = program;
    }
    return program;
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
    footprintCount = 0;
    fillBoxes = [];
    inkBoxes = [];
    inkWidths = [];
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
      const boxes = data.faces.map(({ fills }) => boxOf(fills.position));
      fillBoxes = boxes;
      // Every face's mask, one after another, in one buffer: one upload for
      // the picture, where a buffer per face made each new spread — every
      // step of an Amount drag — create and fill hundreds of them. It opens
      // with the picture's footprint, which puts the stencil back to 0
      // between one batch of masks and the next.
      const footprint = footprintTriangles(boxes);
      let maskLength = footprint.length;
      let maskBytes = 0;
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
        if (maskBytes + length * 4 > 64 * 1024 * 1024) return { first: 0, count: 0, blockers };
        maskBytes += length * 4;
        inBuffer[f] = blockers;
        const mask = { first: maskLength / 2, count: length / 2, blockers: [] };
        maskLength += length;
        return mask;
      });
      const positions = new Float32Array(maskLength);
      positions.set(footprint);
      footprintCount = footprint.length / 2;
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
    const fillProps = (
      run: FillRun,
      first: number,
      count: number,
      depth: 'write' | 'equal' | 'test' | 'only'
    ): FillProps => ({
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
    const paint = (run: FillRun, first: number, count: number, depth: 'write' | 'equal' | 'test' | 'only') =>
      drawFill(fillProps(run, first, count, depth));
    const paintFaces = (faces: readonly number[], depth: 'write' | 'equal' | 'test' | 'only') => {
      if (faces === all) paint(faceRun, 0, faceRun.count, depth);
      else if (faces === xrayOrder) {
        const run = xrayRun();
        paint(run, 0, run.count, depth);
      } else for (const f of faces) paint(faceRun, ranges[f]!.first, ranges[f]!.count, depth);
    };
    const inkFaces = (faces: readonly number[]) => {
      if (faces === all && ink) ink.draw(props);
      else for (const f of faces) faceInkOf(f).draw(props);
    };
    // A cyclic picture's corrected faces go `lanes` at a time, in face order.
    // Each marks its blockers into a stencil bit of its own, the chunk's masks
    // in one batch, then each is drawn where its bit is clear, in another: the
    // state they share is set once a batch, not once a face, and in WebKit
    // every GL call goes to another process. The footprint opens each batch of
    // masks, clearing the bits the last one set; the whole stencil is cleared
    // once, since other pictures write it too.
    //
    // A face off the drawing buffer is left out, and the rest are scissored,
    // mask and all, to where the face can draw: a mask is its blockers' whole
    // fills, so zoomed in, unscissored masks filled the screen hundreds of
    // times a frame.
    type Lane = { face: number; box: ScissorBox };
    const chunksOf = (boxOfFace: (f: number) => ScissorBox | null): Lane[][] => {
      const onBuffer: Lane[] = [];
      for (const face of all) {
        const box = boxOfFace(face);
        if (box) onBuffer.push({ face, box });
      }
      const chunks: Lane[][] = [];
      for (let i = 0; i < onBuffer.length; i += lanes) chunks.push(onBuffer.slice(i, i + lanes));
      return chunks;
    };
    let cleared = false;
    const markChunk = (chunk: readonly Lane[]) => {
      if (!cleared) {
        regl.clear({ stencil: 0 });
        cleared = true;
      }
      const marks: MaskProps[] = [];
      if (footprintCount > 0) {
        const box = scissorUnion(chunk.map(({ box }) => box));
        marks.push({ ...props, position: maskRun!, first: 0, count: footprintCount, ref: 0, writeMask: 255, box });
      }
      chunk.forEach(({ face: f, box }, lane) => {
        const face = masks[f]!;
        const mark = { ...props, ref: 255, writeMask: 1 << lane, box };
        if (face.blockers.length)
          for (const b of face.blockers)
            marks.push({ ...mark, position: faceRun.position, first: ranges[b]!.first, count: ranges[b]!.count });
        else marks.push({ ...mark, position: maskRun!, first: face.first, count: face.count });
      });
      maskCommand(marks.filter(({ count }) => count > 0));
    };
    // A face's fill is inside its box; its lines reach half their pen past theirs.
    const fillBox = (f: number) => scissorOnBuffer(fillBoxes[f]!, props.view, props.viewport, 1);
    const inkBox = (f: number) =>
      scissorOnBuffer(inkBoxes[f]!, props.view, props.viewport, Math.max(1, Math.max(1, props.widthPx) * inkWidths[f]!) / 2 + 1);
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
            for (const chunk of chunksOf(fillBox)) {
              markChunk(chunk);
              fills.corrected(
                chunk.flatMap(({ face, box }, lane) => {
                  const { first, count } = ranges[face]!;
                  return count > 0 ? [{ ...fillProps(faceRun, first, count, 'write'), stencilBit: 1 << lane, box }] : [];
                })
              );
            }
            break;
          case 'corrected-ink':
            for (const chunk of chunksOf(inkBox)) {
              markChunk(chunk);
              if (ink)
                ink.drawMasked(
                  props,
                  chunk.map(({ face, box }, lane) => ({ ...inkRanges[face]!, stencilBit: 1 << lane, box }))
                );
              else
                chunk.forEach(({ face, box }, lane) =>
                  laneTested({ stencilBit: 1 << lane, box }, () => faceInkOf(face).draw(props))
                );
            }
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

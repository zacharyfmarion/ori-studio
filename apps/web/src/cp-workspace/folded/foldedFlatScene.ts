/**
 * The flat folded figure's picture as a {@link PaperScene}: whole faces in
 * painter's order, every layer present, from the kernel's paper scene.
 *
 * The oracle-checked drawer paints one fill per subface — the planar overlap
 * region — with the colour of the face on top of it, and no buried layer
 * exists in its stream (F4). The kernel's `folded_figure_paper_scene` keeps
 * that decision and adds what a painter needs beside it: every face's folded
 * outline with the crease each edge came from, and every subface's whole
 * stack, top down (D6, §8 of `implementation-plans/unified-paper-style-and-export.md`).
 * This module turns the stacks into an order.
 *
 * # Whole faces where the stacks allow
 *
 * Read `stack[i]` over `stack[i + 1]` in every subface as a relation on faces.
 * When that relation is acyclic a topological order draws each face once, as
 * its whole outline, and painter's order reproduces the drawer's picture:
 * wherever two faces overlap the nearer one is drawn later. That is one
 * object per face — no sliver per subface, no seam grid (D2) — and a buried
 * layer is a face an editor can delete to reveal the one beneath.
 *
 * # Woven flaps
 *
 * A layer order can be cyclic — flaps woven so that each lies over the next
 * and the last over the first — and then no order of whole faces is right. The
 * faces of a non-trivial strongly-connected component are split into their
 * subface polygons, each piece placed by its position in that subface's stack,
 * and only those faces: everything outside the cycle stays whole. A split
 * face's outline lines, and its aux lines, go with the piece they bound or
 * cross, so a line the cycle buries is drawn under the piece that buries it;
 * the pieces of one component are emitted deepest first, which is consistent
 * because pieces in different subfaces never overlap.
 *
 * The lines of a piece on top of its subface wait until every piece of the
 * component is down. A piece is cut along subface boundaries that are not its
 * face's outline, so it draws no line there, and a later piece beside a line
 * would paint over the outer half of its stroke: a visible edge left half as
 * wide, broken wherever the neighbouring subface changed. A line on top of its
 * subface is on top of whatever lies beside it, so nothing drawn after it can
 * rightly cover it.
 *
 * A face's pieces on top of their subfaces are one item, its rings those
 * subfaces' polygons: pieces on top never overlap one another, so they can be
 * drawn together, and one path is antialiased as one shape — two abutting
 * polygons each let a sliver of what lies beneath show along the cut, where a
 * buried line reads as a faint seam across the face.
 *
 * # Side, shade, hidden
 *
 * The side is the kernel's `front_up` for the pass. Shade is 1: the flat
 * figure is drawn in flat colour with no light (D7). A face on top of no
 * subface is marked hidden, and its lines with it; a piece of a split face is
 * hidden when it is not the top of its subface.
 */

import type { PaperScene } from '@treemaker/origami-simulator';
import type {
  OristudioCpFoldedPaperAuxLine,
  OristudioCpFoldedPaperEdgeKind,
  OristudioCpFoldedPaperFace,
  OristudioCpFoldedPaperFaceEdge,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedPaperSubface,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type {
  PaperFaceItem,
  PaperItem,
  PaperLineItem,
  PaperLineRole,
  PaperSide,
  SceneBounds,
  ScenePoint,
} from '../../lib/paper/paperScene';

export interface FoldedFlatPaperSceneOptions {
  /** Mark the faces nothing shows; off when the page keeps them anyway. */
  markHidden: boolean;
  /**
   * The kernel's coordinates to scene px: the affine the canvas applies to
   * the figure's render snapshot — its placement over the crease pattern, and
   * the crease-pattern camera's CSS px per user unit.
   */
  toScenePx: (point: Point) => ScenePoint;
  /** The linear scale of {@link toScenePx}: scene px per kernel unit. */
  scale: number;
}

/**
 * The flat figure's scene from the kernel's, every layer included.
 *
 * `kernel` is `folded_figure_paper_scene(handle)` for the figure's current
 * model, so the picture is the pass the canvas shows — front or back, at the
 * model's scale and rotation — and the scene overlays the canvas's picture
 * through the same `toScenePx`.
 */
export function foldedFlatPaperScene(
  kernel: OristudioCpFoldedPaperScene,
  options: FoldedFlatPaperSceneOptions
): PaperScene {
  const faces = kernel.faces;
  const components = faceComponents(faces.length, kernel.subfaces);
  const order = componentOrder(components, kernel.subfaces);
  const context: EmitContext = {
    kernel,
    options,
    top: topFaces(kernel.subfaces),
    epsilon: foldedSceneEpsilon(kernel),
  };
  const items: PaperItem[] = [];
  for (const component of order) {
    if (component.length === 1) emitWholeFace(items, context, component[0]!);
    else emitSplitFaces(items, context, component);
  }
  return {
    bounds: boundsOf(items),
    sheet: kernel.sheet * options.scale,
    items,
  };
}

/**
 * Tolerance for "this point lies on that outline edge", in the kernel's units.
 * The kernel planarises with Oriedita's `UNKNOWN_001`, 1e-4 of a 400-unit
 * sheet; this is forty times that and far below any drawn geometry.
 */
export function foldedSceneEpsilon(kernel: Pick<OristudioCpFoldedPaperScene, 'sheet'>): number {
  return Math.max(kernel.sheet, 1) * 1e-5;
}

/**
 * Which ends of a folded aux line lie on its face's outline — the ends erode
 * retreats (D8). The canvas overlay and the export read the same answer.
 */
export function auxLineOnBoundary(
  kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>,
  aux: OristudioCpFoldedPaperAuxLine,
  epsilon: number
): [boolean, boolean] {
  const outline = kernel.faces[aux.face]?.outline ?? [];
  return [onOutline(outline, aux.from, epsilon), onOutline(outline, aux.to, epsilon)];
}

/* --------------------------------------------------------------------------
 * The face relation: components and their order
 * ----------------------------------------------------------------------- */

/**
 * The faces of each strongly-connected component of the "over" relation, in
 * no particular order between components: Tarjan's algorithm over `stack[i]`
 * → `stack[i + 1]`. A face in no stack is its own component. Exported for
 * the tests, which want to say which faces the producer will split.
 */
export function faceComponents(
  faceCount: number,
  subfaces: readonly OristudioCpFoldedPaperSubface[]
): number[][] {
  const below = facesBelow(faceCount, subfaces);
  const index = new Int32Array(faceCount).fill(-1);
  const lowLink = new Int32Array(faceCount);
  const onStack = new Uint8Array(faceCount);
  const stack: number[] = [];
  const components: number[][] = [];
  let next = 0;

  // Iterative, so a deep stack of faces cannot overflow the call stack: each
  // frame is a face and the position in its `below` list.
  const visit = (root: number): void => {
    const frames: Array<[face: number, edge: number]> = [[root, 0]];
    index[root] = lowLink[root] = next++;
    stack.push(root);
    onStack[root] = 1;
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const [face] = frame;
      const neighbours = below[face]!;
      if (frame[1] < neighbours.length) {
        const child = neighbours[frame[1]]!;
        frame[1] += 1;
        if (index[child] === -1) {
          index[child] = lowLink[child] = next++;
          stack.push(child);
          onStack[child] = 1;
          frames.push([child, 0]);
        } else if (onStack[child]) {
          lowLink[face] = Math.min(lowLink[face]!, index[child]!);
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) lowLink[parent[0]] = Math.min(lowLink[parent[0]]!, lowLink[face]!);
      if (lowLink[face] !== index[face]) continue;
      const component: number[] = [];
      let member: number;
      do {
        member = stack.pop()!;
        onStack[member] = 0;
        component.push(member);
      } while (member !== face);
      component.sort((a, b) => a - b);
      components.push(component);
    }
  };
  for (let face = 0; face < faceCount; face += 1) {
    if (index[face] === -1) visit(face);
  }
  return components;
}

/** Per face, the faces directly beneath it in some subface, each once. */
function facesBelow(
  faceCount: number,
  subfaces: readonly OristudioCpFoldedPaperSubface[]
): number[][] {
  const below: Array<Set<number>> = Array.from({ length: faceCount }, () => new Set());
  for (const { faces_top_to_bottom: stack } of subfaces) {
    for (let i = 0; i + 1 < stack.length; i += 1) {
      const over = stack[i]!;
      const under = stack[i + 1]!;
      if (over < faceCount && under < faceCount && over !== under) below[over]!.add(under);
    }
  }
  return below.map((set) => [...set].sort((a, b) => a - b));
}

/**
 * The components back to front: Kahn's order on the condensation, a component
 * ready once every component beneath it is out. Ties go to the lowest face,
 * so the order is a function of the stacks alone.
 */
function componentOrder(
  components: readonly number[][],
  subfaces: readonly OristudioCpFoldedPaperSubface[]
): number[][] {
  const componentOf = new Int32Array(
    components.reduce((count, component) => count + component.length, 0)
  );
  components.forEach((component, id) => {
    for (const face of component) componentOf[face] = id;
  });
  // Edges of the condensation point *up*: from the component beneath to the
  // one over it, so a component's in-degree counts what must be drawn first.
  const above: Array<Set<number>> = components.map(() => new Set());
  const pending = new Int32Array(components.length);
  for (const { faces_top_to_bottom: stack } of subfaces) {
    for (let i = 0; i + 1 < stack.length; i += 1) {
      const over = componentOf[stack[i]!];
      const under = componentOf[stack[i + 1]!];
      if (over === undefined || under === undefined || over === under) continue;
      if (above[under]!.has(over)) continue;
      above[under]!.add(over);
      pending[over] += 1;
    }
  }
  const byLowestFace = (a: number, b: number): number => components[a]![0]! - components[b]![0]!;
  const ready: number[] = [];
  for (let id = 0; id < components.length; id += 1) if (pending[id] === 0) ready.push(id);
  ready.sort(byLowestFace);
  const order: number[][] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(components[id]!);
    const released: number[] = [];
    for (const over of above[id]!) {
      pending[over] -= 1;
      if (pending[over] === 0) released.push(over);
    }
    if (released.length === 0) continue;
    ready.push(...released);
    ready.sort(byLowestFace);
  }
  return order;
}

/** The faces the drawer paints: the top of at least one subface's stack. */
function topFaces(subfaces: readonly OristudioCpFoldedPaperSubface[]): Set<number> {
  const top = new Set<number>();
  for (const { faces_top_to_bottom: stack } of subfaces) {
    if (stack.length > 0) top.add(stack[0]!);
  }
  return top;
}

/* --------------------------------------------------------------------------
 * Emission
 * ----------------------------------------------------------------------- */

interface EmitContext {
  kernel: OristudioCpFoldedPaperScene;
  options: FoldedFlatPaperSceneOptions;
  top: ReadonlySet<number>;
  epsilon: number;
}

/** A face once, as its outline, followed by its lines. */
function emitWholeFace(items: PaperItem[], context: EmitContext, face: number): void {
  const { kernel, options } = context;
  const source = kernel.faces[face]!;
  const hidden = options.markHidden && !context.top.has(face);
  items.push(faceItem(face, source, [source.outline.map(options.toScenePx)], hidden));
  source.edges.forEach(({ from, to }, edge) => {
    items.push(outlineLine(context, face, edge, from, to, hidden));
  });
  emitAuxLines(items, context, face, hidden);
}

/**
 * A cyclic component's faces as their subface pieces, deepest first. Each
 * piece carries the portions of its face's outline that bound it, and of its
 * face's aux lines that cross it; whatever portion of an outline no piece
 * claimed follows the face's last piece. A face's pieces on top of their
 * subfaces are drawn as one item, and their lines after the whole component
 * (see the module note).
 */
function emitSplitFaces(
  items: PaperItem[],
  context: EmitContext,
  component: readonly number[]
): void {
  const { kernel, options } = context;
  const members = new Set(component);
  const pieces: SplitPiece[] = [];
  kernel.subfaces.forEach(({ faces_top_to_bottom: stack }, subface) => {
    stack.forEach((face, depth) => {
      if (members.has(face)) pieces.push({ subface, face, depth });
    });
  });
  pieces.sort((a, b) => b.depth - a.depth || a.subface - b.subface);

  const claimed = new Map<number, Array<Array<[number, number]>>>();
  for (const face of component) {
    claimed.set(face, kernel.faces[face]!.edges.map(() => []));
  }
  const lastPiece = new Map<number, number>();
  pieces.forEach((piece, index) => lastPiece.set(piece.face, index));
  const auxPortions = auxPortionsByPiece(context, pieces);

  const topRings = new Map<number, ScenePoint[][]>();
  for (const { subface, face, depth } of pieces) {
    if (depth > 0) continue;
    const rings = topRings.get(face) ?? [];
    rings.push(kernel.subfaces[subface]!.polygon.map(options.toScenePx));
    topRings.set(face, rings);
  }

  const onTop: PaperItem[] = [];
  const onTopAux: AuxPortion[] = [];
  pieces.forEach(({ subface, face, depth }, index) => {
    const source = kernel.faces[face]!;
    const polygon = kernel.subfaces[subface]!.polygon;
    const hidden = options.markHidden && depth > 0;
    if (depth > 0) {
      items.push(faceItem(face, source, [polygon.map(options.toScenePx)], hidden));
    } else if (topRings.has(face)) {
      // The face's first piece on top draws all of them.
      items.push(faceItem(face, source, topRings.get(face)!, false));
      topRings.delete(face);
    }
    const lines = depth === 0 ? onTop : items;
    const intervals = claimed.get(face)!;
    for (let i = 0; i < polygon.length; i += 1) {
      const from = polygon[i]!;
      const to = polygon[(i + 1) % polygon.length]!;
      const found = outlineEdgeUnder(source, from, to, context.epsilon);
      if (!found) continue;
      intervals[found.edge]!.push(found.span);
      lines.push(outlineLine(context, face, found.edge, from, to, hidden));
    }
    for (const portion of auxPortions.get(index) ?? []) {
      if (depth === 0) onTopAux.push(portion);
      else items.push(auxLine(context, portion, hidden));
    }
    if (lastPiece.get(face) !== index) return;
    // The face's last piece: what no piece bounded goes here, in the face's
    // own visibility — which is per face, not per portion, so it does not
    // wait with the lines on top.
    const faceHidden = options.markHidden && !context.top.has(face);
    source.edges.forEach((edge, edgeIndex) => {
      const slack = context.epsilon / edgeLength(edge);
      for (const [t0, t1] of uncovered(intervals[edgeIndex]!, slack)) {
        const from = lerp(edge.from, edge.to, t0);
        const to = lerp(edge.from, edge.to, t1);
        items.push(outlineLine(context, face, edgeIndex, from, to, faceHidden));
      }
    });
    for (const portion of auxPortions.get(-1 - face) ?? []) {
      items.push(auxLine(context, portion, faceHidden));
    }
  });
  // Aux under the edges, as a whole face draws its own and the canvas draws
  // every aux line: one along another layer's edge must not ink over it.
  for (const portion of joinedAuxPortions(onTopAux)) items.push(auxLine(context, portion, false));
  items.push(...onTop);
}

interface SplitPiece {
  subface: number;
  face: number;
  depth: number;
}

/** A stretch of one aux line, as parameters along it. */
interface AuxPortion {
  aux: OristudioCpFoldedPaperAuxLine;
  span: [number, number];
}

/**
 * Every aux line of a split face, cut where it crosses the boundary of one of
 * that face's pieces, each stretch handed to the piece it lies in — the
 * shallowest, where it runs along a boundary two pieces share, since that is
 * the one that shows. Keyed by piece index; a stretch no piece holds (only a
 * rounding gap could leave one) is keyed `-1 - face`, for the face's last
 * piece to draw.
 */
function auxPortionsByPiece(
  context: EmitContext,
  pieces: readonly SplitPiece[]
): Map<number, AuxPortion[]> {
  const { kernel, epsilon } = context;
  const portions = new Map<number, AuxPortion[]>();
  const add = (key: number, aux: OristudioCpFoldedPaperAuxLine, span: [number, number]) => {
    const list = portions.get(key) ?? [];
    list.push({ aux, span });
    portions.set(key, list);
  };
  const piecesOf = new Map<number, number[]>();
  pieces.forEach((piece, index) => {
    if (!piecesOf.has(piece.face)) piecesOf.set(piece.face, []);
    piecesOf.get(piece.face)!.push(index);
  });
  for (const aux of kernel.aux_lines) {
    const own = piecesOf.get(aux.face);
    if (!own) continue;
    const slack = epsilon / edgeLength(aux);
    const crossings: number[] = [];
    for (const index of own) {
      const polygon = kernel.subfaces[pieces[index]!.subface]!.polygon;
      for (let i = 0; i < polygon.length; i += 1) {
        const t = crossingOn(aux.from, aux.to, polygon[i]!, polygon[(i + 1) % polygon.length]!, epsilon);
        if (t !== undefined) crossings.push(t);
      }
    }
    // The cuts, a slack apart and clear of the ends, so no stretch is a sliver
    // and the line's own ends stay its ends.
    const cuts = [0];
    for (const t of crossings.sort((a, b) => a - b)) {
      if (t - cuts[cuts.length - 1]! > slack && 1 - t > slack) cuts.push(t);
    }
    cuts.push(1);
    for (let i = 0; i + 1 < cuts.length; i += 1) {
      const span: [number, number] = [cuts[i]!, cuts[i + 1]!];
      const middle = lerp(aux.from, aux.to, (span[0] + span[1]) / 2);
      let holder: number | undefined;
      for (const index of own) {
        const polygon = kernel.subfaces[pieces[index]!.subface]!.polygon;
        if (!insideOrOn(polygon, middle, epsilon)) continue;
        if (holder === undefined || pieces[index]!.depth < pieces[holder]!.depth) holder = index;
      }
      add(holder ?? -1 - aux.face, aux, span);
    }
  }
  return portions;
}

/**
 * The stretches drawn on top, one line per run: stretches of one aux line that
 * meet end to end join, so a dash pattern does not restart at every piece the
 * line crossed.
 */
function joinedAuxPortions(portions: readonly AuxPortion[]): AuxPortion[] {
  const byLine = new Map<OristudioCpFoldedPaperAuxLine, Array<[number, number]>>();
  for (const { aux, span } of portions) {
    if (!byLine.has(aux)) byLine.set(aux, []);
    byLine.get(aux)!.push(span);
  }
  const joined: AuxPortion[] = [];
  for (const [aux, spans] of byLine) {
    spans.sort((a, b) => a[0] - b[0]);
    let run: [number, number] = [...spans[0]!];
    for (const span of spans.slice(1)) {
      if (span[0] === run[1]) run[1] = span[1];
      else {
        joined.push({ aux, span: run });
        run = [...span];
      }
    }
    joined.push({ aux, span: run });
  }
  return joined;
}

/**
 * A stretch of an aux line as a line. Only an end the whole line has retreats
 * under erode, and a stretch carries the whole crease, so the pull is measured
 * on the crease as the canvas measures it: a stretch near a retreating end
 * keeps what the pull leaves of it, and gives up what the pull takes.
 */
function auxLine(context: EmitContext, { aux, span }: AuxPortion, hidden: boolean): PaperLineItem {
  const { toScenePx } = context.options;
  const [atFrom, atTo] = auxLineOnBoundary(context.kernel, aux, context.epsilon);
  const whole = span[0] === 0 && span[1] === 1;
  return {
    kind: 'line',
    role: 'aux',
    a: toScenePx(lerp(aux.from, aux.to, span[0])),
    b: toScenePx(lerp(aux.from, aux.to, span[1])),
    onBoundary: [atFrom && span[0] === 0, atTo && span[1] === 1],
    ...(whole ? {} : { whole: { a: toScenePx(aux.from), b: toScenePx(aux.to), onBoundary: [atFrom, atTo] } }),
    face: aux.face,
    hidden,
  };
}

function emitAuxLines(
  items: PaperItem[],
  context: EmitContext,
  face: number,
  hidden: boolean
): void {
  const { kernel, options } = context;
  for (const aux of kernel.aux_lines) {
    if (aux.face !== face) continue;
    items.push({
      kind: 'line',
      role: 'aux',
      a: options.toScenePx(aux.from),
      b: options.toScenePx(aux.to),
      onBoundary: auxLineOnBoundary(kernel, aux, context.epsilon),
      face,
      hidden,
    });
  }
}

function faceItem(
  face: number,
  source: OristudioCpFoldedPaperFace,
  rings: ScenePoint[][],
  hidden: boolean
): PaperFaceItem {
  const side: PaperSide = source.front_up ? 'front' : 'back';
  return { kind: 'face', face, side, rings, shade: 1, hidden };
}

/**
 * A portion of a face's outline edge as a line. A paper edge or a fold is the
 * outline itself and never retreats under erode; a flat crease on the outline
 * retreats at an end where a border or fold of the same outline meets it —
 * the mesh producer's rule, read off the outline instead of a vertex count.
 */
function outlineLine(
  context: EmitContext,
  face: number,
  edge: number,
  from: Point,
  to: Point,
  hidden: boolean
): PaperLineItem {
  const { edges } = context.kernel.faces[face]!;
  const own = edges[edge]!;
  const role = roleOf(own.kind);
  const count = edges.length;
  const previous = edges[(edge + count - 1) % count]!;
  const following = edges[(edge + 1) % count]!;
  // An end retreats when it is the edge's own vertex — not a cut a subface
  // piece left mid-edge — and the outline turns there through paper or a fold.
  const retreats = (neighbour: OristudioCpFoldedPaperFaceEdge, end: Point, vertex: Point) =>
    role === 'aux' && neighbour.kind !== 'flat' && samePoint(end, vertex, context.epsilon);
  return {
    kind: 'line',
    role,
    a: context.options.toScenePx(from),
    b: context.options.toScenePx(to),
    onBoundary: [retreats(previous, from, own.from), retreats(following, to, own.to)],
    face,
    hidden,
  };
}

function roleOf(kind: OristudioCpFoldedPaperEdgeKind): PaperLineRole {
  return kind === 'flat' ? 'aux' : 'edge';
}

/* --------------------------------------------------------------------------
 * Geometry
 * ----------------------------------------------------------------------- */

/**
 * The outline edge of `face` that the segment `from`→`to` lies along, and the
 * span of it the segment covers as parameters of that edge; undefined when
 * the segment lies on none.
 */
function outlineEdgeUnder(
  face: OristudioCpFoldedPaperFace,
  from: Point,
  to: Point,
  epsilon: number
): { edge: number; span: [number, number] } | undefined {
  for (let edge = 0; edge < face.edges.length; edge += 1) {
    const { from: a, to: b } = face.edges[edge]!;
    const t0 = parameterOn(a, b, from, epsilon);
    if (t0 === undefined) continue;
    const t1 = parameterOn(a, b, to, epsilon);
    if (t1 === undefined) continue;
    return { edge, span: t0 <= t1 ? [t0, t1] : [t1, t0] };
  }
  return undefined;
}

/** Where `point` sits along `a`→`b`, or undefined when it is off the segment. */
function parameterOn(a: Point, b: Point, point: Point, epsilon: number): number | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 <= epsilon * epsilon) return undefined;
  const px = point.x - a.x;
  const py = point.y - a.y;
  const distance = Math.abs(dx * py - dy * px) / Math.sqrt(length2);
  if (distance > epsilon) return undefined;
  const t = (px * dx + py * dy) / length2;
  const slack = epsilon / Math.sqrt(length2);
  if (t < -slack || t > 1 + slack) return undefined;
  return Math.min(1, Math.max(0, t));
}

/**
 * Where the segment `a`→`b` crosses or touches the segment `p`→`q`, as a
 * parameter along `a`→`b`; undefined when they miss or run parallel (a
 * collinear run is cut by the neighbouring edges, which meet it at its ends).
 */
function crossingOn(a: Point, b: Point, p: Point, q: Point, epsilon: number): number | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = q.x - p.x;
  const sy = q.y - p.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= Number.EPSILON * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return undefined;
  const t = ((p.x - a.x) * sy - (p.y - a.y) * sx) / denominator;
  const u = ((p.x - a.x) * ry - (p.y - a.y) * rx) / denominator;
  const tSlack = epsilon / Math.hypot(rx, ry);
  const uSlack = epsilon / Math.hypot(sx, sy);
  if (t < -tSlack || t > 1 + tSlack || u < -uSlack || u > 1 + uSlack) return undefined;
  return Math.min(1, Math.max(0, t));
}

/** Whether `point` is inside `polygon` (even-odd) or within `epsilon` of its boundary. */
function insideOrOn(polygon: readonly Point[], point: Point, epsilon: number): boolean {
  if (onOutline(polygon, point, epsilon)) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > point.y !== b.y > point.y) {
      const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

/** The gaps of `[0, 1]` that `intervals` leave, ignoring gaps under `slack`. */
function uncovered(
  intervals: ReadonlyArray<readonly [number, number]>,
  slack: number
): Array<[number, number]> {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const gaps: Array<[number, number]> = [];
  let reached = 0;
  for (const [start, end] of sorted) {
    if (start - reached > slack) gaps.push([reached, start]);
    reached = Math.max(reached, end);
  }
  if (1 - reached > slack) gaps.push([reached, 1]);
  return gaps;
}

function onOutline(outline: readonly Point[], point: Point, epsilon: number): boolean {
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    if (parameterOn(a, b, point, epsilon) !== undefined) return true;
  }
  return false;
}

function samePoint(a: Point, b: Point, epsilon: number): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

function edgeLength(edge: { from: Point; to: Point }): number {
  return Math.max(Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y), Number.EPSILON);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The extent of every item, hidden ones included; zeros when there are none. */
function boundsOf(items: readonly PaperItem[]): SceneBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    const points =
      item.kind === 'face'
        ? item.rings.flat()
        : item.kind === 'line'
          ? [item.a, item.b]
          : [
              [item.bounds.minX, item.bounds.minY],
              [item.bounds.maxX, item.bounds.maxY],
            ];
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

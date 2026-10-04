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
 * layer is a face an editor can delete to reveal the one beneath. A whole face
 * draws its outline itself (`PaperFaceItem.outline`), so reshaping it in an
 * editor moves the fill and the outline together.
 *
 * # Woven flaps
 *
 * A layer order can be cyclic — flaps woven so that each lies over the next
 * and the last over the first — and then no order of whole faces is right:
 * whichever is drawn last covers the others everywhere. The faces of a
 * non-trivial strongly-connected component are drawn whole anyway, in the
 * order that leaves the least of the picture wrong (`wovenDrawOrder`), and
 * what is wrong is patched. Each face stays one object an editor can reshape.
 *
 * A subface needs a patch when its top face was drawn before ink that must not
 * show there: a face of its stack beneath the top, or the stroke of a buried
 * edge along its boundary (`hiddenInk`). The patch is the top face again, cut
 * to the subface, and it goes in right after the last of that ink — not at the
 * end — so whatever is drawn after it still covers it. It carries the lines
 * its paint covers that nothing drawn later draws again: every visible line
 * along its boundary or ending at one of its corners whose faces were all
 * drawn before it, and its face's aux lines inside it. A patch is the
 * subface's top piece, so a line on top of its subface is on top of whatever
 * lies beside it, and drawing it again over the patch is always right. The
 * patches that go in at one place are one group in the file.
 *
 * What this gives up is the order of the buried layers inside a woven region:
 * the picture is the drawer's, but deleting a face in an editor there can
 * reveal a deeper layer than the one directly beneath. Ordering those layers
 * exactly needs the region cut into a piece per subface and depth, which on a
 * real model is most of its faces in thousands of pieces.
 *
 * # Side, shade, hidden
 *
 * The side is the kernel's `front_up` for the pass. Shade is 1: the flat
 * figure is drawn in flat colour with no light (D7). A face on top of no
 * subface is marked hidden, and its lines with it; a patch, a top piece, never
 * is.
 *
 * # Spread
 *
 * With a spread every point a face carries — its outline, its outline's
 * lines, its aux lines, its patches and the lines they carry — steps by that
 * face's field (`foldedLayerSpread.ts`) after it is placed, and the items go
 * out in the same order. Without one, nothing is added to any point.
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
import { layerSpread, type LayerSpreadOptions } from './foldedLayerSpread';
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
  /**
   * Step the layers apart by depth. A covered layer may then show an edge, so
   * a caller that spreads keeps every face: `markHidden: false`.
   */
  spread?: LayerSpreadOptions;
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
  const epsilon = foldedSceneEpsilon(kernel);
  const { edges, ink, order } = paintPlan(kernel, epsilon);
  const context: EmitContext = {
    kernel,
    markHidden: options.markHidden,
    top: topFaces(kernel.subfaces),
    epsilon,
    at: placement(kernel, order, options, epsilon),
  };
  const position = new Int32Array(kernel.faces.length);
  order.forEach((face, at) => {
    position[face] = at;
  });
  const patches = patchesAfter(kernel, ink, position);
  const items: PaperItem[] = [];
  let groups = 0;
  order.forEach((face, at) => {
    emitWholeFace(items, context, face);
    const batch = patches.get(at);
    if (!batch) return;
    groups += 1;
    emitPatches(items, context, edges, batch, { at, position, group: `patches-${groups}` });
  });
  return {
    bounds: boundsOf(items),
    sheet: kernel.sheet * options.scale,
    items,
  };
}

/** The faces back to front, as {@link foldedFlatPaperScene} draws them whole. */
export function foldedPaintOrder(kernel: OristudioCpFoldedPaperScene): number[] {
  return paintPlan(kernel, foldedSceneEpsilon(kernel)).order;
}

/**
 * The order of whole faces, and what the woven components' patches are
 * worked out from: the subfaces' edges and the ink each woven subface must
 * not show.
 */
function paintPlan(
  kernel: OristudioCpFoldedPaperScene,
  epsilon: number
): { edges: SubfaceEdges; ink: Map<number, number[]>; order: number[] } {
  const components = faceComponents(kernel.faces.length, kernel.subfaces);
  const edges = new SubfaceEdges(kernel, epsilon);
  const ink = wovenInk(kernel, edges, components);
  const order = componentOrder(components, kernel.subfaces).flatMap((component) =>
    component.length === 1 ? component : wovenDrawOrder(component, wovenArcs(kernel, ink, component))
  );
  return { edges, ink, order };
}

/**
 * Where a point a face carries goes in the scene: placed, and stepped by the
 * face's field when the layers are spread.
 */
function placement(
  kernel: OristudioCpFoldedPaperScene,
  order: readonly number[],
  { toScenePx, scale, spread }: FoldedFlatPaperSceneOptions,
  epsilon: number
): EmitContext['at'] {
  if (!spread) return (_face, point) => toScenePx(point);
  const { offset } = layerSpread(kernel, order, spread, { scale, epsilon });
  return (face, point) => {
    const [x, y] = toScenePx(point);
    const [dx, dy] = offset(face, point);
    return [x + dx, y + dy];
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
 * the tests, which want to say which faces are woven.
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
 * Woven components: an order of whole faces, and where it needs patches
 * ----------------------------------------------------------------------- */

/** A face edge a subface edge runs along: the face, and which of its edges. */
interface Owner {
  face: number;
  edge: number;
}

/**
 * The subfaces' boundaries as edges, each knowing the subface across it and
 * the face edges it runs along.
 *
 * The kernel's subfaces are one planar arrangement: two subfaces that share a
 * vertex give it the same coordinates, and no face has a corner partway along
 * a subface edge, so a subface edge lies wholly on any face edge it runs along.
 * A face with an edge along it lies on one side of it, so it is in the stack
 * of one of the two subfaces there, and those two stacks are all that is
 * searched for its owners.
 */
class SubfaceEdges {
  readonly from: Point[] = [];
  readonly to: Point[] = [];
  readonly subface: number[] = [];
  /** The subface on the other side, or -1 on the figure's rim. */
  readonly across: number[] = [];
  /** The same edge seen from either side: one key for both. */
  readonly key: string[] = [];
  /** Per subface, its edges in ring order. */
  readonly ofSubface: number[][];
  private readonly atVertex = new Map<string, number[]>();
  private readonly owners = new Map<number, Owner[]>();

  constructor(
    private readonly kernel: OristudioCpFoldedPaperScene,
    private readonly epsilon: number
  ) {
    const byKey = new Map<string, number[]>();
    const add = (map: Map<string, number[]>, key: string, id: number) => {
      const list = map.get(key);
      if (list) list.push(id);
      else map.set(key, [id]);
    };
    this.ofSubface = kernel.subfaces.map(({ polygon }, subface) =>
      polygon.map((from, i) => {
        const to = polygon[(i + 1) % polygon.length]!;
        const id = this.from.length;
        const key = [vertexKey(from), vertexKey(to)].sort().join('|');
        this.from.push(from);
        this.to.push(to);
        this.subface.push(subface);
        this.across.push(-1);
        this.key.push(key);
        add(byKey, key, id);
        add(this.atVertex, vertexKey(from), id);
        add(this.atVertex, vertexKey(to), id);
        return id;
      })
    );
    for (const ids of byKey.values()) {
      if (ids.length !== 2) continue;
      this.across[ids[0]!] = this.subface[ids[1]!]!;
      this.across[ids[1]!] = this.subface[ids[0]!]!;
    }
  }

  /** The edges with an end at this vertex. */
  endingAt(vertex: Point): readonly number[] {
    return this.atVertex.get(vertexKey(vertex)) ?? [];
  }

  /**
   * The faces with a corner at this vertex, and which corner: looked for in
   * the stacks of the subfaces round it, since a face covers one of them.
   */
  cornersAt(vertex: Point): Array<{ face: number; corner: number }> {
    const faces = new Set<number>();
    for (const id of this.endingAt(vertex)) {
      for (const face of this.stack(this.subface[id]!)) faces.add(face);
      for (const face of this.stack(this.across[id]!)) faces.add(face);
    }
    const found: Array<{ face: number; corner: number }> = [];
    for (const face of faces) {
      const corner = this.kernel.faces[face]!.outline.findIndex((point) =>
        samePoint(point, vertex, this.epsilon)
      );
      if (corner >= 0) found.push({ face, corner });
    }
    return found;
  }

  /** Whether a visible line ends at this vertex. */
  lineEndsAt(vertex: Point): boolean {
    return this.endingAt(vertex).some((id) => this.visibleOwner(id) !== undefined);
  }

  /** The face edges this edge runs along. */
  ownersOf(id: number): readonly Owner[] {
    const known = this.owners.get(id);
    if (known) return known;
    const from = this.from[id]!;
    const to = this.to[id]!;
    const candidates = new Set(this.stack(this.subface[id]!));
    for (const face of this.stack(this.across[id]!)) candidates.add(face);
    const found: Owner[] = [];
    for (const face of candidates) {
      const edge = this.kernel.faces[face]!.edges.findIndex(
        (e) =>
          parameterOn(e.from, e.to, from, this.epsilon) !== undefined &&
          parameterOn(e.from, e.to, to, this.epsilon) !== undefined
      );
      if (edge >= 0) found.push({ face, edge });
    }
    this.owners.set(id, found);
    return found;
  }

  /**
   * The face edge that makes this edge a line on the page — one of the top
   * faces on either side runs along it — or undefined when no line shows.
   */
  visibleOwner(id: number): Owner | undefined {
    const tops = [this.top(this.subface[id]!), this.top(this.across[id]!)];
    return this.ownersOf(id).find((owner) => tops.includes(owner.face));
  }

  private stack(subface: number): readonly number[] {
    return subface >= 0 ? this.kernel.subfaces[subface]!.faces_top_to_bottom : [];
  }

  private top(subface: number): number {
    return subface >= 0 ? (this.kernel.subfaces[subface]!.faces_top_to_bottom[0] ?? -1) : -1;
  }
}

function vertexKey(point: Point): string {
  return `${point.x},${point.y}`;
}

/**
 * Per subface whose top face is woven, the faces of that face's component
 * whose ink reaches it and must not show there: every face of its stack
 * beneath the top; every face with an edge along its boundary that is no
 * line there — a buried edge, whose stroke straddles the boundary; and every
 * face with a corner at one of its vertices whose rounded join reaches into
 * it. A stroke along a line that shows is the same ink in the same place, so
 * it is not counted, and nor is a corner where a line ends: the line's own
 * round end inks the whole disc round the vertex.
 *
 * Only a woven component's faces can be drawn out of the stacks' order, so
 * nothing else can leave ink showing: the components themselves are drawn
 * bottom to top.
 */
function wovenInk(
  kernel: OristudioCpFoldedPaperScene,
  edges: SubfaceEdges,
  components: readonly number[][]
): Map<number, number[]> {
  const woven = new Map<number, ReadonlySet<number>>();
  for (const component of components) {
    if (component.length < 2) continue;
    const members = new Set(component);
    for (const face of component) woven.set(face, members);
  }
  const ink = new Map<number, number[]>();
  if (woven.size === 0) return ink;
  kernel.subfaces.forEach(({ faces_top_to_bottom: stack }, subface) => {
    const top = stack[0];
    const members = top === undefined ? undefined : woven.get(top);
    if (!members) return;
    const found = new Set(stack.slice(1).filter((face) => members.has(face)));
    for (const id of edges.ofSubface[subface]!) {
      if (edges.visibleOwner(id)) continue;
      for (const { face } of edges.ownersOf(id)) {
        if (face !== top && members.has(face)) found.add(face);
      }
    }
    const { polygon } = kernel.subfaces[subface]!;
    polygon.forEach((vertex, at) => {
      if (edges.lineEndsAt(vertex)) return;
      for (const { face, corner } of edges.cornersAt(vertex)) {
        if (face === top || !members.has(face) || stack.includes(face)) continue;
        if (joinReaches(kernel.faces[face]!.outline, corner, polygon, at)) found.add(face);
      }
    });
    if (found.size > 0) ink.set(subface, [...found].sort((a, b) => a - b));
  });
  return ink;
}

/**
 * The "draw this after that" weights inside one woven component: a subface's
 * top face after every face of its ink, weighted by the subface's area, so the
 * order breaks the least area of the picture.
 */
function wovenArcs(
  kernel: OristudioCpFoldedPaperScene,
  ink: ReadonlyMap<number, readonly number[]>,
  component: readonly number[]
): Map<number, Map<number, number>> {
  const members = new Set(component);
  const arcs = new Map<number, Map<number, number>>();
  for (const [subface, faces] of ink) {
    const { polygon, faces_top_to_bottom: stack } = kernel.subfaces[subface]!;
    const top = stack[0]!;
    if (!members.has(top)) continue;
    const weight = polygonArea(polygon);
    const after = arcs.get(top) ?? new Map<number, number>();
    for (const face of faces) after.set(face, (after.get(face) ?? 0) + weight);
    arcs.set(top, after);
  }
  return arcs;
}

/**
 * A woven component's faces bottom to top: the order breaking the least
 * weight of "draw this after that", by Eades, Lin and Smyth's greedy
 * heuristic for a minimum feedback arc set. An arc `u → v` of weight `w` asks
 * for `u` to be drawn after `v`. Faces no arc must follow go to the bottom and
 * faces none must precede to the top, and when neither is left the face that
 * most outweighs what it must follow goes to the top. Ties go to the lowest
 * face, so the order is a function of the arcs alone. Exported for the tests.
 */
export function wovenDrawOrder(
  faces: readonly number[],
  after: ReadonlyMap<number, ReadonlyMap<number, number>>
): number[] {
  const left = new Set(faces);
  const sorted = [...faces].sort((a, b) => a - b);
  const before = new Map<number, Map<number, number>>();
  const outWeight = new Map<number, number>();
  const inWeight = new Map<number, number>();
  const outCount = new Map<number, number>();
  const inCount = new Map<number, number>();
  const add = (map: Map<number, number>, key: number, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value);
  for (const [u, targets] of after) {
    if (!left.has(u)) continue;
    for (const [v, weight] of targets) {
      if (!left.has(v) || u === v) continue;
      add(outWeight, u, weight);
      add(inWeight, v, weight);
      add(outCount, u, 1);
      add(inCount, v, 1);
      const into = before.get(v) ?? new Map<number, number>();
      into.set(u, weight);
      before.set(v, into);
    }
  }
  const take = (face: number): void => {
    left.delete(face);
    for (const [v, weight] of after.get(face) ?? []) {
      if (!left.has(v) || v === face) continue;
      add(inWeight, v, -weight);
      add(inCount, v, -1);
    }
    for (const [u, weight] of before.get(face) ?? []) {
      if (!left.has(u)) continue;
      add(outWeight, u, -weight);
      add(outCount, u, -1);
    }
  };
  const bottom: number[] = [];
  const top: number[] = [];
  while (left.size > 0) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const face of sorted) {
        if (left.has(face) && !outCount.get(face)) {
          bottom.push(face);
          take(face);
          moved = true;
        }
      }
      for (const face of sorted) {
        if (left.has(face) && !inCount.get(face)) {
          top.push(face);
          take(face);
          moved = true;
        }
      }
    }
    let best = -1;
    let bestScore = -Infinity;
    for (const face of sorted) {
      if (!left.has(face)) continue;
      const score = (outWeight.get(face) ?? 0) - (inWeight.get(face) ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = face;
      }
    }
    if (best < 0) break;
    top.push(best);
    take(best);
  }
  return [...bottom, ...top.reverse()];
}

/**
 * Whether a face's rounded join at one of its corners reaches into a polygon
 * that has a vertex there. A stroke's two edges cover what lies beside them;
 * the join adds the directions behind both, and the polygon's own corner
 * spans the directions into it. Sampled across that span, which is enough to
 * tell the two apart at any corner a fold can make.
 */
function joinReaches(
  outline: readonly Point[],
  corner: number,
  polygon: readonly Point[],
  vertex: number
): boolean {
  const at = outline[corner]!;
  const toward = (point: Point) => {
    const length = Math.hypot(point.x - at.x, point.y - at.y);
    return { x: (point.x - at.x) / length, y: (point.y - at.y) / length };
  };
  const back = toward(outline[(corner + outline.length - 1) % outline.length]!);
  const ahead = toward(outline[(corner + 1) % outline.length]!);
  const previous = polygon[(vertex + polygon.length - 1) % polygon.length]!;
  const next = polygon[(vertex + 1) % polygon.length]!;
  const from = Math.atan2(previous.y - at.y, previous.x - at.x);
  const to = Math.atan2(next.y - at.y, next.x - at.x);
  // The polygon's inside, counterclockwise from one of its edges to the other.
  const [start, end] = signedArea(polygon) > 0 ? [to, from] : [from, to];
  let span = end - start;
  while (span <= 0) span += 2 * Math.PI;
  for (let i = 1; i < JOIN_SAMPLES; i += 1) {
    const angle = start + (span * i) / JOIN_SAMPLES;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    if (x * back.x + y * back.y < 0 && x * ahead.x + y * ahead.y < 0) return true;
  }
  return false;
}

/** Directions sampled across a polygon's corner by {@link joinReaches}. */
const JOIN_SAMPLES = 16;

/**
 * Per position in the draw order, the subfaces patched right after the face
 * drawn there: each subface whose top face was drawn before some of its ink,
 * after the last of that ink — where everything the patch must cover is down,
 * and whatever is drawn later still covers the patch.
 */
function patchesAfter(
  kernel: OristudioCpFoldedPaperScene,
  ink: ReadonlyMap<number, readonly number[]>,
  position: Int32Array
): Map<number, number[]> {
  const after = new Map<number, number[]>();
  for (const [subface, faces] of ink) {
    const top = position[kernel.subfaces[subface]!.faces_top_to_bottom[0]!]!;
    const last = Math.max(...faces.map((face) => position[face]!));
    if (last < top) continue;
    after.set(last, [...(after.get(last) ?? []), subface]);
  }
  return after;
}

/* --------------------------------------------------------------------------
 * Emission
 * ----------------------------------------------------------------------- */

interface EmitContext {
  kernel: OristudioCpFoldedPaperScene;
  markHidden: boolean;
  top: ReadonlySet<number>;
  epsilon: number;
  /** A point on a face, in the scene. */
  at: (face: number, point: Point) => ScenePoint;
}

/**
 * A face once, as its outline, followed by its lines. An outline whose edges
 * all take one role is drawn by the face itself, so the fill and its outline
 * reach a drawing editor as one object; a mixed one is a line per edge.
 */
function emitWholeFace(items: PaperItem[], context: EmitContext, face: number): void {
  const { kernel } = context;
  const source = kernel.faces[face]!;
  const hidden = context.markHidden && !context.top.has(face);
  const outline = outlineRole(source);
  const ring = source.outline.map((point) => context.at(face, point));
  items.push(faceItem(face, source, [ring], hidden, outline));
  if (!outline) {
    source.edges.forEach(({ from, to }, edge) => {
      items.push(outlineLine(context, face, edge, from, to, hidden));
    });
  }
  emitAuxLines(items, context, face, hidden);
}

/**
 * The role every edge of a face's outline takes, or undefined when they
 * differ. A loop of one role never erodes — an aux end retreats only where a
 * border or fold of the same outline meets it ({@link outlineLine}) — so the
 * face's own stroke draws exactly the lines it replaces.
 */
function outlineRole(source: OristudioCpFoldedPaperFace): PaperLineRole | undefined {
  const roles = new Set(source.edges.map((edge) => roleOf(edge.kind)));
  return roles.size === 1 ? [...roles][0] : undefined;
}

/**
 * A batch of patches, and what they carry. Each is a subface's top face
 * again, cut to the subface. Then the stretches of those faces' aux lines
 * inside them, under the edges as everywhere else; then every visible line
 * their paint reaches — along a patch's boundary, or ending at one of its
 * corners, where the patch's seam stroke reaches past it — whose faces were
 * all drawn before it. A line a face drawn later runs along is drawn again by
 * that face. Each line once, joined round at both ends so the stretches meet
 * whole; all of it one group.
 */
function emitPatches(
  items: PaperItem[],
  context: EmitContext,
  edges: SubfaceEdges,
  batch: readonly number[],
  { at, position, group }: { at: number; position: Int32Array; group: string }
): void {
  const { kernel } = context;
  for (const subface of batch) {
    const { polygon, faces_top_to_bottom: stack } = kernel.subfaces[subface]!;
    const top = stack[0]!;
    const ring = polygon.map((point) => context.at(top, point));
    items.push({ ...faceItem(top, kernel.faces[top]!, [ring], false), group });
  }
  for (const subface of batch) {
    const { polygon, faces_top_to_bottom: stack } = kernel.subfaces[subface]!;
    for (const aux of kernel.aux_lines) {
      if (aux.face !== stack[0]) continue;
      for (const portion of auxPortionsIn(context, aux, polygon)) {
        items.push({ ...auxLine(context, portion, false), group });
      }
    }
  }
  const carried = new Set<string>();
  for (const subface of batch) {
    const reached = new Set(edges.ofSubface[subface]);
    for (const corner of kernel.subfaces[subface]!.polygon) {
      for (const id of edges.endingAt(corner)) reached.add(id);
    }
    for (const id of reached) {
      if (carried.has(edges.key[id]!)) continue;
      const owner = edges.visibleOwner(id);
      if (!owner) continue;
      if (edges.ownersOf(id).some(({ face }) => position[face]! > at)) continue;
      carried.add(edges.key[id]!);
      // In the owner edge's own direction, so its ends are read as that
      // edge's ends.
      const along = kernel.faces[owner.face]!.edges[owner.edge]!;
      const [from, to] = [edges.from[id]!, edges.to[id]!].sort(
        (a, b) =>
          (parameterOn(along.from, along.to, a, context.epsilon) ?? 0) -
          (parameterOn(along.from, along.to, b, context.epsilon) ?? 0)
      ) as [Point, Point];
      const line = outlineLine(context, owner.face, owner.edge, from, to, false);
      items.push({ ...line, joined: [true, true], group });
    }
  }
}

/** A stretch of one aux line, as parameters along it. */
interface AuxPortion {
  aux: OristudioCpFoldedPaperAuxLine;
  span: [number, number];
}

/**
 * The stretches of an aux line inside a polygon: cut where it crosses the
 * boundary, the cuts a slack apart and clear of its ends, so no stretch is a
 * sliver and its own ends stay its ends.
 */
function auxPortionsIn(
  context: EmitContext,
  aux: OristudioCpFoldedPaperAuxLine,
  polygon: readonly Point[]
): AuxPortion[] {
  const { epsilon } = context;
  const slack = epsilon / edgeLength(aux);
  const crossings: number[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const t = crossingOn(aux.from, aux.to, polygon[i]!, polygon[(i + 1) % polygon.length]!, epsilon);
    if (t !== undefined) crossings.push(t);
  }
  const cuts = [0];
  for (const t of crossings.sort((a, b) => a - b)) {
    if (t - cuts[cuts.length - 1]! > slack && 1 - t > slack) cuts.push(t);
  }
  cuts.push(1);
  const portions: AuxPortion[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const span: [number, number] = [cuts[i]!, cuts[i + 1]!];
    if (insideOrOn(polygon, lerp(aux.from, aux.to, (span[0] + span[1]) / 2), epsilon)) {
      portions.push({ aux, span });
    }
  }
  return portions;
}

/**
 * A stretch of an aux line as a line. Only an end the whole line has retreats
 * under erode, and a stretch carries the whole crease, so the pull is measured
 * on the crease as the canvas measures it: a stretch near a retreating end
 * keeps what the pull leaves of it, and gives up what the pull takes.
 */
function auxLine(context: EmitContext, { aux, span }: AuxPortion, hidden: boolean): PaperLineItem {
  const place = (point: Point) => context.at(aux.face, point);
  const [atFrom, atTo] = auxLineOnBoundary(context.kernel, aux, context.epsilon);
  const whole = span[0] === 0 && span[1] === 1;
  return {
    kind: 'line',
    role: 'aux',
    a: place(lerp(aux.from, aux.to, span[0])),
    b: place(lerp(aux.from, aux.to, span[1])),
    onBoundary: [atFrom && span[0] === 0, atTo && span[1] === 1],
    ...(whole ? {} : { whole: { a: place(aux.from), b: place(aux.to), onBoundary: [atFrom, atTo] } }),
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
  const { kernel } = context;
  for (const aux of kernel.aux_lines) {
    if (aux.face !== face) continue;
    items.push({
      kind: 'line',
      role: 'aux',
      a: context.at(face, aux.from),
      b: context.at(face, aux.to),
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
  hidden: boolean,
  outline?: PaperLineRole
): PaperFaceItem {
  const side: PaperSide = source.front_up ? 'front' : 'back';
  return { kind: 'face', face, side, rings, ...(outline ? { outline } : {}), shade: 1, hidden };
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
  // An end retreats when it is the edge's own vertex — not a point partway
  // along it where a subface edge ends — and the outline turns there through
  // paper or a fold.
  const retreats = (neighbour: OristudioCpFoldedPaperFaceEdge, end: Point, vertex: Point) =>
    role === 'aux' && neighbour.kind !== 'flat' && samePoint(end, vertex, context.epsilon);
  return {
    kind: 'line',
    role,
    a: context.at(face, from),
    b: context.at(face, to),
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

/** A polygon's area, positive when it turns counterclockwise (y up). */
function signedArea(polygon: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** A polygon's area, whichever way it turns. */
function polygonArea(polygon: readonly Point[]): number {
  return Math.abs(signedArea(polygon));
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

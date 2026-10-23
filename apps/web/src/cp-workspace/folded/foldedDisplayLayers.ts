/**
 * A flat folded scene's display layers (the cross-section's rule, plan D14 of
 * `implementation-plans/fold-workspace.md`): faces joined across flat creases.
 * A precrease — a fold and unfold — or a crease a flap was unfolded along
 * leaves a flat crease, and the faces either side of it lie in one physical
 * layer, carried by one isometry: one piece of paper, which a spread and the
 * painter's order must treat as one, or a line that is no fold starts to
 * change the picture.
 *
 * # Joined by name
 *
 * Two faces are joined across an edge when both name it by the same two
 * wireframe points (`OristudioCpFoldedPaperFace.points`), both call it flat,
 * and both show the same side. The names are the sheet's vertices, so the two
 * faces of one crease name its ends alike while layers stacked in one place
 * name theirs apart: a precrease through a stack is a flat edge per layer, in
 * one place, each joining its own layer's two faces. Faces that agree on two
 * points and on the side they show are carried by one isometry, so the side is
 * all there is to check beside the names. A face the kernel could not name is
 * a layer by itself.
 *
 * # A layer's outline
 *
 * Without its flat creases a layer would be one face, and a spread treats it
 * as that face ({@link displayLayerOutlines}): its faces' rings merged, the
 * flat edges between them gone, and with them the points only a flat crease
 * made — where a precrease ends on a fold or the paper's edge.
 *
 * Pure.
 */

import type { OristudioCpFoldedPaperFace, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';

/** A scene's faces grouped into display layers. */
export interface FoldedDisplayLayers {
  /** Per face, the index of its layer. */
  readonly layerOf: Int32Array;
  /** Per layer, its faces in ascending order; the layers in the order of their least faces. */
  readonly layers: readonly (readonly number[])[];
}

/**
 * Per face, whether its outline is named point for point (schema 2): every
 * corner a wireframe point, so its corners can be matched with its
 * neighbours'.
 */
export function namedFaces(kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>): boolean[] {
  return kernel.faces.map(
    ({ points, outline }) =>
      points.length > 0 &&
      points.length === outline.length &&
      points.every((vertex) => Number.isInteger(vertex) && vertex >= 0)
  );
}

/** The scene's display layers: faces joined across the flat edges both sides name alike and show one side over. */
export function foldedDisplayLayers(kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>): FoldedDisplayLayers {
  const count = kernel.faces.length;
  const parent = Int32Array.from({ length: count }, (_, face) => face);
  const root = (face: number): number => {
    let at = face;
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]!]!;
      at = parent[at]!;
    }
    return at;
  };

  const isNamed = namedFaces(kernel);
  // Each flat edge by its two names, with the faces that have it.
  const sides = new Map<string, number[]>();
  kernel.faces.forEach(({ points, edges }, face) => {
    if (!isNamed[face] || edges.length !== points.length) return;
    edges.forEach(({ kind }, edge) => {
      if (kind !== 'flat') return;
      const key = edgeKey(points[edge]!, points[(edge + 1) % points.length]!);
      const faces = sides.get(key);
      if (faces) faces.push(face);
      else sides.set(key, [face]);
    });
  });
  for (const faces of sides.values()) {
    // A sheet edge has two sides; more is a scene this rule cannot read.
    if (faces.length !== 2) continue;
    const [a, b] = faces as [number, number];
    if (a === b || kernel.faces[a]!.front_up !== kernel.faces[b]!.front_up) continue;
    const [ra, rb] = [root(a), root(b)];
    // The lower face is the root, so a layer is known by its least face.
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }

  const layerOf = new Int32Array(count);
  const layers: number[][] = [];
  const indexOfRoot = new Map<number, number>();
  for (let face = 0; face < count; face += 1) {
    const top = root(face);
    let layer = indexOfRoot.get(top);
    if (layer === undefined) {
      layer = layers.length;
      indexOfRoot.set(top, layer);
      layers.push([]);
    }
    layers[layer]!.push(face);
    layerOf[face] = layer;
  }
  return { layerOf, layers };
}

/** A display layer's outline as the face it would be without its flat creases. */
export interface FoldedLayerOutline {
  /** Its corners, as the faces name them. */
  readonly points: readonly number[];
  /** Where each corner lies in the scene, as the faces' outlines have it. */
  readonly outline: readonly Point[];
}

/**
 * Per layer, its outline as the one face it would be without its flat
 * creases: its faces' rings merged along the edges they share, and the points
 * only a flat crease made left out — a point where a flat crease ends that
 * every fold and paper edge through it passes straight through, along the
 * outline. A layer of one face with no such point keeps that face's own ring,
 * so a scene without flat creases is read exactly as it was.
 *
 * Null for a layer this cannot outline: one whose faces are not all named, or
 * whose merged outline is not one simple ring (a layer with a hole, or one
 * that meets itself at a point). Each of its faces is then read as it is.
 */
export function displayLayerOutlines(
  kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>,
  { layers }: FoldedDisplayLayers,
  epsilon: number
): (FoldedLayerOutline | null)[] {
  const isNamed = namedFaces(kernel);
  const creases = creasesAtPoints(kernel, isNamed);
  return layers.map((faces) => {
    if (!faces.every((face) => isNamed[face])) return null;
    const merged = faces.length === 1 ? kernel.faces[faces[0]!]! : mergedRing(kernel, faces);
    return merged && withoutFlatOnlyPoints(merged, creases, epsilon);
  });
}

/** What meets at each named point: whether a flat crease ends there, and where every other edge from it runs. */
interface CreasesAtPoints {
  flat: Set<number>;
  /** Per point, the points a fold or a paper edge runs to from it. */
  others: Map<number, Set<number>>;
}

function creasesAtPoints(kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>, isNamed: readonly boolean[]): CreasesAtPoints {
  const flat = new Set<number>();
  const others = new Map<number, Set<number>>();
  const link = (from: number, to: number) => {
    const set = others.get(from);
    if (set) set.add(to);
    else others.set(from, new Set([to]));
  };
  kernel.faces.forEach(({ points, edges }, face) => {
    if (!isNamed[face] || edges.length !== points.length) return;
    edges.forEach(({ kind }, edge) => {
      const [a, b] = [points[edge]!, points[(edge + 1) % points.length]!];
      if (kind === 'flat') {
        flat.add(a);
        flat.add(b);
      } else {
        link(a, b);
        link(b, a);
      }
    });
  });
  return { flat, others };
}

/**
 * A layer's faces' rings merged into one, counter-clockwise: the edges no two
 * of its faces share, joined end to end. Null when they are not one simple
 * ring.
 */
function mergedRing(
  kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>,
  faces: readonly number[]
): FoldedLayerOutline | null {
  const where = new Map<number, Point>();
  const directed = new Set<string>();
  const ends: Array<[number, number]> = [];
  for (const face of faces) {
    const { points, outline } = counterClockwise(kernel.faces[face]!);
    points.forEach((vertex, corner) => {
      where.set(vertex, outline[corner]!);
      const next = points[(corner + 1) % points.length]!;
      const key = `${vertex}>${next}`;
      // Two faces of one layer never run one edge the same way: they would overlap.
      if (directed.has(key)) return;
      directed.add(key);
      ends.push([vertex, next]);
    });
  }
  const next = new Map<number, number>();
  for (const [from, to] of ends) {
    if (directed.has(`${to}>${from}`)) continue;
    // Two ways on from one point: the outline meets itself there.
    if (next.has(from)) return null;
    next.set(from, to);
  }
  if (next.size < 3) return null;
  const start = Math.min(...next.keys());
  const points: number[] = [];
  let at = start;
  do {
    points.push(at);
    at = next.get(at) ?? -1;
  } while (at !== start && at >= 0 && points.length <= next.size);
  // Every outline edge on the one ring, or the layer has a hole.
  if (at !== start || points.length !== next.size) return null;
  return { points, outline: points.map((vertex) => where.get(vertex)!) };
}

/** A face's ring, turned counter-clockwise if it runs the other way. */
function counterClockwise({ points, outline }: OristudioCpFoldedPaperFace): FoldedLayerOutline {
  if (ringArea(outline) >= 0) return { points, outline };
  return { points: [...points].reverse(), outline: [...outline].reverse() };
}

/**
 * The outline without the points only a flat crease made: where a flat crease
 * ends, every other edge there runs to the corners either side along the
 * outline, and the outline goes straight through. The ring keeps its shape —
 * those points lie on the edges either side — and is returned as it is when
 * none is left out.
 */
function withoutFlatOnlyPoints(
  ring: FoldedLayerOutline,
  { flat, others }: CreasesAtPoints,
  epsilon: number
): FoldedLayerOutline | null {
  const { points, outline } = ring;
  const n = points.length;
  const keep = points.map((vertex, corner) => {
    if (!flat.has(vertex)) return true;
    const before = (corner + n - 1) % n;
    const after = (corner + 1) % n;
    const beside = new Set([points[before]!, points[after]!]);
    for (const other of others.get(vertex) ?? []) if (!beside.has(other)) return true;
    return !straightThrough(outline[before]!, outline[corner]!, outline[after]!, epsilon);
  });
  if (keep.every(Boolean)) return ring;
  const kept = points.flatMap((vertex, corner) => (keep[corner] ? [corner] : []));
  if (kept.length < 3) return null;
  return { points: kept.map((corner) => points[corner]!), outline: kept.map((corner) => outline[corner]!) };
}

/** Whether `at` lies on the segment from `from` to `to`, strictly between them, within `epsilon`. */
function straightThrough(from: Point, at: Point, to: Point, epsilon: number): boolean {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const length = Math.hypot(dx, dy);
  if (length <= epsilon) return false;
  const off = Math.abs(dx * (at.y - from.y) - dy * (at.x - from.x)) / length;
  const along = (dx * (at.x - from.x) + dy * (at.y - from.y)) / length;
  return off <= epsilon && along > epsilon && along < length - epsilon;
}

/** Shoelace: a closed ring's signed area, positive when it turns counter-clockwise (y up). */
export function ringArea(ring: readonly Point[]): number {
  let twice = 0;
  ring.forEach(({ x, y }, i) => {
    const next = ring[(i + 1) % ring.length]!;
    twice += x * next.y - next.x * y;
  });
  return twice / 2;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

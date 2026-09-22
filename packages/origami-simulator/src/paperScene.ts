// The picture a folded mesh makes, as data: faces and lines in the order a
// painter draws them, with nothing about pens or colours in it.
//
// This is the half of the old SVG serializer that knew geometry — project,
// cut for a correct painter's order, find what is buried, put faces back
// together — with the half that knew ink taken out. A painter turns a scene
// into SVG or pixels by reading a style; the two producers that build scenes
// (the simulator, and the 3D folded figure through the same mesh path) never
// see one. That split is what lets the app's paper style reach every export
// through one painter rather than one serializer per surface.
//
// Scene coordinates are the CSS pixels of the camera the surface showed, which
// every producer already has. The painter is the one place they become points.
import { projectVertices, type CameraUniforms, type ProjectedVertices } from './webgl/camera.js';
import { buildBsp, traverseBsp, type BspItem, type Vec3 } from './bsp.js';
import { findVisiblePieces, type DrawnPiece } from './hiddenPieces.js';
import { coplanarRuns, outlineOf, sourceFaceGroups, type RunPiece } from './coplanarRuns.js';
import { shadeFor, type Vec3Like } from './shading.js';
import { EDGE_CODE } from './edgeCodes.js';
import {
  CREASE_DEPTH_BIAS_NDC,
  collectCreases,
  collectFaces,
  pointBounds,
  screenPoints,
  viewNormal,
  type Crease,
  type SvgMeshTopology,
  type Triangle,
} from './projectedMesh.js';

export type ScenePoint = [number, number];

export type PaperLineRole = 'edge' | 'mountain' | 'valley' | 'aux';

export type PaperSide = 'front' | 'back';

export interface PaperFaceItem {
  kind: 'face';
  /** The source face this piece belongs to; pieces of one face share it. */
  face: number;
  side: PaperSide;
  /**
   * One ring for a simple region; several when the region has holes, drawn
   * as one even-odd path. Every ring is closed, its last point joining its
   * first.
   */
  rings: ScenePoint[][];
  /** The face shader's flat lighting factor; 1 is unlit. */
  shade: number;
  /** No pixel of the page shows this piece — see {@link MeshToPaperSceneOptions.markHidden}. */
  hidden: boolean;
}

export interface PaperLineItem {
  kind: 'line';
  role: PaperLineRole;
  a: ScenePoint;
  b: ScenePoint;
  /**
   * Whether each endpoint should retreat under the style's erode: it lies on
   * the sheet boundary, or on a fold edge of the layer the line is drawn on.
   * See `boundaryVertices` for the rule.
   */
  onBoundary: [boolean, boolean];
  /** The face the line is drawn on, when one is known. */
  face?: number;
  hidden: boolean;
}

export type PaperItem = PaperFaceItem | PaperLineItem;

export interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PaperScene {
  /** Extent of every item, hidden ones included. Zero when there are none. */
  bounds: SceneBounds;
  /** The unfolded sheet's extent in scene px, the unit erode is measured in. */
  sheet: number;
  /** Draw order, back to front. */
  items: PaperItem[];
}

export interface MeshToPaperSceneOptions {
  /** The unfolded sheet's extent, in the world units the positions are in. */
  sheet: number;
  /**
   * Apply the perspective divide. True (the default) matches the WebGL
   * renderer; false matches the orthographic canvas-2D fallback.
   */
  perspective?: boolean;
  /**
   * Mark the pieces no pixel of the page shows. On by default. Marked, never
   * dropped: a painter that keeps buried faces draws them in place, so that
   * deleting a face in an editor reveals the one beneath.
   */
  markHidden?: boolean;
  /** Shade faces by their normal against {@link lightDir}. Off gives every face 1. */
  lighting?: boolean;
  /** View-space light direction (x right, y up, z toward the eye). Unlit when absent. */
  lightDir?: Vec3Like;
  /**
   * Source face per triangle of `faceIndices`. Absent, triangles joined by a
   * facet edge are one face (`sourceFaceGroups`).
   */
  faceGroups?: ArrayLike<number>;
  /**
   * Which side of the paper each triangle shows, 0 front and 1 back, per
   * triangle of `faceIndices`. Absent, the screen winding decides, as the GPU's
   * `gl_FrontFacing` does.
   */
  sides?: ArrayLike<number>;
  /**
   * Draw order among coplanar triangles, lowest first, per triangle of
   * `faceIndices` — the kernel's stacking within one plane, which the tree
   * cannot recover. See `BspItem.order`.
   */
  order?: ArrayLike<number>;
  /**
   * The widest line the painter will draw, in scene px. It is the tree's ink
   * allowance — a crease closer to a plane than its own ink is not cut by it —
   * and the stroke the hidden test measures a line by. Defaults to the default
   * edge pen, 0.9 pt at 4/3 px per pt.
   */
  lineWidth?: number;
  /** Leave faces out of the scene entirely. On by default. */
  showFaces?: boolean;
  /** Leave lines out of the scene entirely. On by default. */
  showEdges?: boolean;
}

const DEFAULT_LINE_WIDTH = 1.2;

/**
 * The scene a mesh makes at a camera: faces and lines in painter's order, hidden
 * pieces marked, each face's pieces put back together where the order allows.
 *
 * Cut in *screen* space carrying view depth as the third axis, not in view
 * space. Two reasons, and they are the same reason: the vertex shader's
 * perspective is a per-vertex warp of x and y rather than a real projective
 * divide, so a straight segment in view space does not project to a straight
 * line — splitting there and projecting the pieces separately bends a crease
 * visibly at every cut. And this space is exactly what the GPU depth-tests in:
 * `gl_Position.w` stays 1, so the rasterizer interpolates depth linearly across
 * *screen* coordinates, which makes every triangle planar here by construction.
 */
export function meshToPaperScene(
  positions: Float32Array,
  topology: SvgMeshTopology,
  camera: CameraUniforms,
  options: MeshToPaperSceneOptions
): PaperScene {
  const sheet = options.sheet * camera.scale;
  const lineWidth = Math.max(0, options.lineWidth ?? DEFAULT_LINE_WIDTH);
  const projected = projectVertices(positions, camera, { perspective: options.perspective ?? true });
  // Collected even when faces are not drawn: they are what tells a line which
  // face it is drawn on.
  const triangles = collectFaces(topology, projected);
  const creases =
    options.showEdges === false
      ? []
      : collectCreases(topology, projected, (code) => code <= EDGE_CODE.aux);
  const attributes = triangleAttributes(triangles, topology, projected, options);
  const faceOfLine = lineFaces(creases, triangles, attributes);
  const boundary = boundaryVertices(topology, projected.count);

  const items: BspItem[] = [];
  if (options.showFaces !== false) {
    triangles.forEach((triangle, index) => {
      items.push({
        kind: 0,
        ref: index,
        order: options.order?.[triangle.source],
        points: screenPoints(projected, [triangle.a, triangle.b, triangle.c]),
      });
    });
  }
  creases.forEach((crease, index) => {
    // Nudged toward the eye by the same amount the edge shader biases by, and
    // for the same reason: a crease lies exactly on the boundary between two
    // faces, and the nearer of those two is drawn after it. Without the bias
    // that face's edge clips the crease down the middle, so it renders at a
    // fraction of its width — measured at 0.1px of a declared 1.1px on the
    // valley creases of a real model, while the mountains kept 0.9px, purely
    // because of which side each one's nearer face fell on.
    items.push({
      kind: 1,
      ref: index,
      points: screenPoints(projected, [crease.from, crease.to], CREASE_DEPTH_BIAS_NDC * camera.depthRange),
    });
  });
  // Depth is a plain comparison in this space, so the view is orthographic and
  // the eye sits infinitely far along +depth (nearer = larger depth). A line's
  // ink is measured in page units here, which is what lets the tree leave it
  // whole against a plane it only grazes — see `BuildBspOptions.edgeInk`.
  const eye: Vec3 = [0, 0, Number.MAX_SAFE_INTEGER];
  const pieces = traverseBsp(buildBsp(items, { edgeInk: lineWidth / 2, eye }), eye).map(
    (item) => ({ item, screen: item.points.map(([x, y]): ScenePoint => [x, y]) })
  );
  const bounds = pointBounds(pieces.map((piece) => piece.screen));
  if (!bounds) return { bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, sheet, items: [] };

  // The order says what covers what; it does not say what survives. Sampled on
  // the pieces rather than on merged outlines, because the test reads better on
  // small pieces than on one big shape — the same reason the cull used to come
  // before the merge when it deleted rather than marked.
  const hidden =
    options.markHidden === false
      ? null
      : findVisiblePieces(
          pieces.map(
            ({ item, screen }): DrawnPiece => ({
              points: screen,
              strokeWidth: item.kind === 1 ? lineWidth : 0,
            })
          ),
          {
            minX: bounds.minX - lineWidth,
            minY: bounds.minY - lineWidth,
            width: bounds.maxX - bounds.minX + lineWidth * 2,
            height: bounds.maxY - bounds.minY + lineWidth * 2,
          }
        ).map((visible) => !visible);

  // Merge only among the pieces that show. A hidden piece between two visible
  // pieces of one face used to be deleted, leaving them adjacent; here it stays,
  // and the merged face is emitted where the run's *last* piece stood, so the
  // hidden piece still precedes everything that covered it. On the page nothing
  // changes — every piece that hid the buried one is still drawn after it — but
  // a painter that keeps buried faces promises that deleting a cover reveals
  // what the tree put beneath it, and a run's earlier pieces have moved past
  // the buried piece. That is harmless for a buried piece of the run's own
  // face, which tiles the same plane and overlaps none of it, and for one that
  // lies off to the side; a run is cut where a buried piece of another face,
  // or a buried line, overlaps what the run has gathered so far — see
  // `splitAtBuried`.
  const survivors: number[] = [];
  pieces.forEach((_, index) => {
    if (!hidden?.[index]) survivors.push(index);
  });
  const runPieces: RunPiece[] = survivors.map((index) => {
    const { item, screen } = pieces[index]!;
    const face = item.kind === 0 ? attributes[item.ref]! : null;
    return {
      // A line never merges, and neither does a face whose group is missing.
      group: face ? face.face : -1,
      // Compared, not assumed equal from the face: two triangles of one face
      // shade alike up to floating-point noise, which this rounds away.
      fill: face ? `${face.side}:${face.shade.toFixed(3)}` : '',
      points: screen,
    };
  });
  const merged = new Map<number, PaperFaceItem>();
  const absorbed = new Set<number>();
  const pieceBounds = pieces.map(({ screen }) => pointBounds([screen]));
  const buriedOverlaps = (index: number, group: number, extent: SceneBounds): boolean => {
    const { item } = pieces[index]!;
    if (item.kind === 0 && attributes[item.ref]!.face === group) return false;
    const box = pieceBounds[index];
    return (
      box !== null &&
      box.minX <= extent.maxX &&
      box.maxX >= extent.minX &&
      box.minY <= extent.maxY &&
      box.maxY >= extent.minY
    );
  };
  const runs: Array<[number, number]> = [];
  for (const run of coplanarRuns(runPieces)) {
    runs.push(...splitAtBuried(run, survivors, runPieces, pieceBounds, buriedOverlaps));
  }
  for (const [start, end] of runs) {
    const rings = outlineOf(runPieces.slice(start, end).map((piece) => piece.points));
    // Null means the run does not resolve to closed loops, so it goes out as
    // the pieces it already is.
    if (!rings) continue;
    for (let i = start; i < end; i += 1) absorbed.add(survivors[i]!);
    const first = pieces[survivors[start]!]!.item;
    merged.set(
      survivors[end - 1]!,
      faceItem(
        attributes[first.ref]!,
        rings.map((ring) => ring.map(([x, y]): ScenePoint => [x, y])),
        false
      )
    );
  }

  const out: PaperItem[] = [];
  pieces.forEach(({ item, screen }, index) => {
    const replacement = merged.get(index);
    if (replacement) {
      out.push(replacement);
      return;
    }
    if (absorbed.has(index)) return;
    const isHidden = hidden?.[index] ?? false;
    if (item.kind === 0) {
      out.push(faceItem(attributes[item.ref]!, [screen], isHidden));
      return;
    }
    const crease = creases[item.ref]!;
    out.push(lineItem(crease, item, screen, projected, boundary, faceOfLine[item.ref], isHidden));
  });

  return { bounds, sheet, items: out };
}

/**
 * A run of survivors, cut wherever a buried piece that sits between two of its
 * pieces overlaps the pieces gathered before it. Each half still merges and is
 * emitted at its own last piece, so no piece of the run moves past a buried
 * piece it could hide. The overlap test is by bounding box — conservative, so
 * it only ever leaves a face in more pieces than necessary — and a buried piece
 * of the run's own face never cuts it: the pieces of one face tile a plane and
 * cannot cover each other.
 */
function splitAtBuried(
  [start, end]: readonly [number, number],
  survivors: readonly number[],
  runPieces: readonly RunPiece[],
  pieceBounds: ReadonlyArray<SceneBounds | null>,
  buriedOverlaps: (index: number, group: number, extent: SceneBounds) => boolean
): Array<[number, number]> {
  const group = runPieces[start]!.group;
  const runs: Array<[number, number]> = [];
  let runStart = start;
  let extent: SceneBounds | null = null;
  for (let i = start; i < end; i += 1) {
    if (extent !== null) {
      let cut = false;
      for (let buried = survivors[i - 1]! + 1; buried < survivors[i]! && !cut; buried += 1) {
        cut = buriedOverlaps(buried, group, extent);
      }
      if (cut) {
        if (i - runStart > 1) runs.push([runStart, i]);
        runStart = i;
        extent = null;
      }
    }
    const box = pieceBounds[survivors[i]!];
    if (!box) continue;
    extent = extent
      ? {
          minX: Math.min(extent.minX, box.minX),
          minY: Math.min(extent.minY, box.minY),
          maxX: Math.max(extent.maxX, box.maxX),
          maxY: Math.max(extent.maxY, box.maxY),
        }
      : box;
  }
  if (end - runStart > 1) runs.push([runStart, end]);
  return runs;
}

interface TriangleAttributes {
  face: number;
  side: PaperSide;
  shade: number;
}

/** What every piece of a triangle inherits: its face, its side and its shade. */
function triangleAttributes(
  triangles: readonly Triangle[],
  topology: SvgMeshTopology,
  projected: ProjectedVertices,
  options: MeshToPaperSceneOptions
): TriangleAttributes[] {
  const groups = options.faceGroups ?? sourceFaceGroups(topology);
  const lightDir = options.lighting ? options.lightDir : undefined;
  return triangles.map((triangle) => ({
    face: groups[triangle.source] ?? -1,
    // The kernel knows which side of the paper a face shows; the simulator
    // does not, and reads it off the screen winding as `gl_FrontFacing` does.
    side: options.sides
      ? options.sides[triangle.source] === 1
        ? 'back'
        : 'front'
      : triangle.winding >= 0
        ? 'front'
        : 'back',
    shade: lightDir ? shadeFor(viewNormal(triangle, projected), lightDir) : 1,
  }));
}

/**
 * The face each crease is drawn on: of the triangles that share its edge, the
 * one nearer the eye — the face whose edge the line is painted over, since
 * the line is nudged toward the eye past it. Undefined for an edge no drawn
 * triangle owns. Index-aligned with `creases`.
 */
function lineFaces(
  creases: readonly Crease[],
  triangles: readonly Triangle[],
  attributes: readonly TriangleAttributes[]
): Array<number | undefined> {
  const nearest = new Map<string, { depth: number; face: number }>();
  triangles.forEach((triangle, index) => {
    const face = attributes[index]!.face;
    for (const [from, to] of [
      [triangle.a, triangle.b],
      [triangle.b, triangle.c],
      [triangle.c, triangle.a],
    ] as const) {
      const key = vertexKey(from, to);
      const current = nearest.get(key);
      if (!current || triangle.depth > current.depth) {
        nearest.set(key, { depth: triangle.depth, face });
      }
    }
  });
  return creases.map((crease) => nearest.get(vertexKey(crease.from, crease.to))?.face);
}

function vertexKey(from: number, to: number): string {
  return from < to ? `${from}_${to}` : `${to}_${from}`;
}

/**
 * Per vertex, how many border or fold edges meet there.
 *
 * The erode rule reads off this: a crease's endpoint retreats when it lies on
 * the outline of the layer the crease is drawn on, and that outline is made of
 * the sheet's border and of the folds where the paper turns. Auxiliary creases
 * and facet edges are interior to a layer and do not count. So an endpoint is
 * on the boundary when *another* border or fold edge meets it there: a crease
 * ending at the paper's edge, or at a vertex where other creases meet, retreats;
 * an auxiliary line ending in the middle of a face does not.
 *
 * A paper edge is the outline itself and never retreats, so its own endpoints
 * report false whatever meets them — see {@link lineItem}.
 */
function boundaryVertices(topology: SvgMeshTopology, vertexCount: number): Uint16Array {
  const counts = new Uint16Array(vertexCount);
  for (let edge = 0; edge < topology.edgeAssignments.length; edge += 1) {
    if (topology.edgeAssignments[edge]! > EDGE_CODE.valley) continue;
    const from = topology.edgeIndices[edge * 2]!;
    const to = topology.edgeIndices[edge * 2 + 1]!;
    if (from < vertexCount) counts[from] += 1;
    if (to < vertexCount) counts[to] += 1;
  }
  return counts;
}

function faceItem(
  attributes: TriangleAttributes,
  rings: ScenePoint[][],
  hidden: boolean
): PaperFaceItem {
  return {
    kind: 'face',
    face: attributes.face,
    side: attributes.side,
    rings,
    shade: attributes.shade,
    hidden,
  };
}

function lineItem(
  crease: Crease,
  piece: BspItem,
  screen: readonly ScenePoint[],
  projected: ProjectedVertices,
  boundary: Uint16Array,
  face: number | undefined,
  hidden: boolean
): PaperLineItem {
  const role = roleOf(crease.assignment);
  // A cut leaves a piece ending mid-crease; that end is nobody's boundary, or
  // erode would open a gap where the two pieces meet. An end is the crease's
  // own only when it still carries the vertex's projected position.
  const own = (end: 0 | 1, vertex: number) => {
    const point = piece.points[end]!;
    return point[0] === projected.screen[vertex * 2] && point[1] === projected.screen[vertex * 2 + 1];
  };
  const onBoundary = (vertex: number) =>
    role !== 'edge' && (boundary[vertex] ?? 0) - (crease.assignment <= EDGE_CODE.valley ? 1 : 0) > 0;
  return {
    kind: 'line',
    role,
    a: screen[0]!,
    b: screen[1]!,
    onBoundary: [
      own(0, crease.from) && onBoundary(crease.from),
      own(1, crease.to) && onBoundary(crease.to),
    ],
    ...(face === undefined ? {} : { face }),
    hidden,
  };
}

function roleOf(code: number): PaperLineRole {
  switch (code) {
    case EDGE_CODE.mountain:
      return 'mountain';
    case EDGE_CODE.valley:
      return 'valley';
    case EDGE_CODE.aux:
      return 'aux';
    default:
      return 'edge';
  }
}

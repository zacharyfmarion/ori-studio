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
// Scene coordinates are CSS pixels. The two producers here use the camera the
// surface showed, which they already have. The app's References step is drawn
// at the page's own scale instead, so that one of its px is 0.75 pt on the
// page whatever the sheet size and its marks keep their on-screen size. The
// painter is the one place they become points.
import {
  projectVertices,
  projectViewPoint,
  type CameraUniforms,
  type ProjectedVertices,
} from './webgl/camera.js';
import { buildBsp, traverseBsp, type BspItem, type Vec3 } from './bsp.js';
import { findVisiblePieces, type DrawnPiece } from './hiddenPieces.js';
import { coplanarRuns, outlineOf, sourceFaceGroups, type RunPiece } from './coplanarRuns.js';
import { shadeFor, type Vec3Like } from './shading.js';
import { EDGE_CODE } from './edgeCodes.js';
import { EDGE_BOUNDARY_A, EDGE_BOUNDARY_B, edgeBoundaryFlags } from './edgeBoundary.js';
import {
  CREASE_DEPTH_BIAS_NDC,
  collectCreases,
  collectFaces,
  pointBounds,
  screenPoints,
  viewNormal,
  viewPoints,
  type Crease,
  type SvgMeshTopology,
  type Triangle,
} from './projectedMesh.js';

export type ScenePoint = [number, number];

/**
 * What a line is, which is what picks its pen. `'mountain'` / `'valley'` are a
 * line of a crease pattern — a fold, as the mesh and a folded figure emit
 * them. `'diagram-mountain'` / `'diagram-valley'` are an instruction on a
 * diagram step — fold here, this way — drawn in the style's diagram-crease
 * pens; only a References step emits them.
 */
export type PaperLineRole =
  | 'edge'
  | 'mountain'
  | 'valley'
  | 'diagram-mountain'
  | 'diagram-valley'
  | 'aux';

export type PaperSide = 'front' | 'back';

export interface PaperFaceItem {
  kind: 'face';
  /** The source face this piece belongs to; pieces of one face share it. */
  face: number;
  side: PaperSide;
  /**
   * One ring for a simple region; several for a region with holes, or for
   * disjoint pieces of one face drawn as one item — one even-odd set either
   * way, drawn as one even-odd path: a ring inside an odd number of the
   * others is a hole. Every ring is closed, its last point joining its first.
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
   * Whether each endpoint should retreat under the style's erode: the line
   * is an aux crease, and the end lies on the sheet boundary or on a fold
   * edge of the layer the line is drawn on. See `edgeBoundaryFlags` for the
   * rule, which the GPU and canvas-2D edge passes read from the same module.
   */
  onBoundary: [boolean, boolean];
  /**
   * The crease this line is a piece of, when the tree cut it: the whole
   * crease's ends in scene px and which of them retreat. Erode is measured on
   * the crease, as the edge shader and the canvas-2D fallback measure it —
   * the crease retreats, and the piece is what is left of it between the cuts
   * — so a piece cut near a flagged end keeps the stub past the pull where its
   * own length would have collapsed it, and a piece that does not own that end
   * still gives up what the pull takes. Absent when the line is the whole
   * crease, whose `a`, `b` and `onBoundary` then say it all.
   */
  whole?: PaperLineWhole;
  /**
   * Whether each end continues into another line of the scene — the rest of
   * its own crease past a cut, or another crease or edge meeting it at a
   * vertex — where the painter joins the two rather than capping the end. A
   * mesh draws a crease as a chain of pieces, and a butt cap at every link
   * left a wedge-shaped gap on the outside of each bend. Absent, both ends are
   * the line's own and take its pen's cap.
   */
  joined?: [boolean, boolean];
  /** The face the line is drawn on, when one is known. */
  face?: number;
  hidden: boolean;
}

/** A cut line's whole crease: see {@link PaperLineItem.whole}. */
export interface PaperLineWhole {
  a: ScenePoint;
  b: ScenePoint;
  onBoundary: [boolean, boolean];
}

/**
 * Element markup the painter places on the page as it is: the step diagram's
 * symbols — fold arrows, the turn-over glyph, regions, marks and letters —
 * drawn by the one implementation that draws them on screen rather than by a
 * second copy in the painter. The mesh producer never emits one; the painter
 * wraps it in a group scaled from scene px to the page, in item order, so a
 * producer places it where the symbols belong among the faces and lines.
 */
export interface PaperMarkupItem {
  kind: 'markup';
  /**
   * SVG element markup in scene px, self-contained: every colour and width an
   * attribute, no class or stylesheet reference, since a file carries none.
   */
  svg: string;
  /**
   * What the markup draws inside, in scene px. The painter cannot measure
   * markup, so the producer states it — a scene's `bounds` covers it like any
   * other item's extent.
   */
  bounds: SceneBounds;
  /** Never buried: the symbols are drawn over the paper, not on a layer of it. */
  hidden: false;
}

export type PaperItem = PaperFaceItem | PaperLineItem | PaperMarkupItem;

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
   * The same, per edge of `edgeIndices`: where a crease sits among the
   * coplanar faces it is drawn with. Absent, every crease is order 0. Only
   * read with {@link layers}, where a crease shares its plane's node with the
   * faces; otherwise a crease is nudged off its plane and never coplanar.
   */
  edgeOrder?: ArrayLike<number>;
  /**
   * The widest line the painter will draw, in scene px. It is the tree's ink
   * allowance — a crease closer to a plane than its own ink is not cut by it —
   * and the stroke the hidden test measures a line by. Defaults to the default
   * edge pen, 0.9 pt at 4/3 px per pt.
   */
  lineWidth?: number;
  /**
   * Treat the mesh's coplanar faces as ordered layers.
   *
   * For a producer whose kernel has already decided which faces share a plane,
   * to its own tolerance, and ordered them there — the 3D folded figure, whose
   * layers are exactly coplanar and every one of which is kept for the
   * painter. The tree's job is then only to order plane against plane, and
   * four things change from the simulator's rule:
   *
   * - the tree is cut in **view** space rather than screen space, so the
   *   kernel's planes are planes there (see the note on `meshToPaperScene`);
   * - a crease is left exactly in its plane rather than nudged toward the eye
   *   by the edge shader's bias, and the tree is given no ink allowance for
   *   it, so it lands in its plane's coplanar node with the faces;
   * - a coplanar node is sorted by {@link order} / {@link edgeOrder} before
   *   kind (`BuildBspOptions.orderBeforeKind`), so a buried layer's creases
   *   are drawn over that layer and under the one that covers it;
   * - `coplanarEps` is the kernel's coplanarity distance, in the world units
   *   the positions are in, rather than the tree's own machine-precision
   *   default, so float rounding cannot split a plane the kernel joined.
   *
   * {@link lineWidth} still measures the hidden test's stroke.
   */
  layers?: { coplanarEps: number };
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
 *
 * Except under {@link MeshToPaperSceneOptions.layers}, which cuts in view
 * space. The warp is a central projection from the eye at `camDist`, and that
 * bends a *plane*: two triangles of one kernel plane are coplanar in view
 * space and not in this one, by a few percent of the model's radius at a
 * tilt, so a plane's stack of layers cannot be one coplanar node here and its
 * creases fall under their own faces. Measured on the folded fixtures, most
 * of a tilted figure's creases did. In view space the kernel's planes are
 * planes, the eye is a real point and the traversal is perspective-exact; the
 * cut points project onto the straight screen segment because the projection
 * is central (a cut point stays on its line to 1e-14 px). What that gives up
 * is the GPU's screen-linear depth — a second-order difference where two
 * planes nearly touch, which the window resolves by draw order rather than by
 * depth anyway.
 */
export function meshToPaperScene(
  positions: Float32Array,
  topology: SvgMeshTopology,
  camera: CameraUniforms,
  options: MeshToPaperSceneOptions
): PaperScene {
  const sheet = options.sheet * camera.scale;
  const lineWidth = Math.max(0, options.lineWidth ?? DEFAULT_LINE_WIDTH);
  const layers = options.layers;
  const perspective = options.perspective ?? true;
  const projected = projectVertices(positions, camera, { perspective });
  // Where the tree cuts: see the note above. Under `layers` a crease has no
  // nudge — it belongs to a layer of the plane it lies in, and its order there
  // says which.
  const cutPoints = (indices: readonly number[], crease: boolean): Vec3[] =>
    layers
      ? viewPoints(projected, indices)
      : screenPoints(projected, indices, crease ? CREASE_DEPTH_BIAS_NDC * camera.depthRange : 0);
  const toScreen = (point: Vec3): ScenePoint =>
    layers ? projectViewPoint(point, camera, perspective) : [point[0], point[1]];
  // Collected even when faces are not drawn: they are what tells a line which
  // face it is drawn on.
  const triangles = collectFaces(topology, projected);
  const creases =
    options.showEdges === false
      ? []
      : collectCreases(topology, projected, (code) => code <= EDGE_CODE.aux);
  const attributes = triangleAttributes(triangles, topology, projected, options);
  const byEdge = trianglesByEdge(triangles);
  const faceOfLine = lineFaces(creases, triangles, attributes, byEdge);
  const boundary = edgeBoundaryFlags(topology, projected.count);
  // How many drawn lines end at each vertex: an end another one shares is a
  // joint, not an end of the line.
  const linesAt = new Uint32Array(projected.count);
  for (const crease of creases) {
    linesAt[crease.from] = (linesAt[crease.from] ?? 0) + 1;
    linesAt[crease.to] = (linesAt[crease.to] ?? 0) + 1;
  }

  const items: BspItem[] = [];
  if (options.showFaces !== false) {
    triangles.forEach((triangle, index) => {
      items.push({
        kind: 0,
        ref: index,
        order: options.order?.[triangle.source],
        points: cutPoints([triangle.a, triangle.b, triangle.c], false),
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
      order: layers ? options.edgeOrder?.[crease.edge] : undefined,
      points: cutPoints([crease.from, crease.to], true),
    });
  });
  // In screen space depth is a plain comparison, so the view is orthographic
  // and the eye sits infinitely far along +depth (nearer = larger depth); a
  // line's ink is measured in page units there, which is what lets the tree
  // leave it whole against a plane it only grazes — see
  // `BuildBspOptions.edgeInk`. In view space the eye is where the shader puts
  // it, at `camDist` along +depth, or as far as the orthographic fallback's.
  const eye: Vec3 = [0, 0, layers && perspective ? camera.camDist : Number.MAX_SAFE_INTEGER];
  const tree = layers
    ? buildBsp(items, { edgeInk: 0, eye, coplanarEps: layers.coplanarEps, orderBeforeKind: true })
    : buildBsp(items, { edgeInk: lineWidth / 2, eye });
  const traversed = traverseBsp(tree, eye);
  const pieces = (
    layers
      ? creasesAfterOwnFace(
          traversed,
          {
            faceOf: (piece) => attributes[piece.ref]!.face,
            ownersOf: (crease) => {
              const { from, to } = creases[crease.ref]!;
              return byEdge.get(vertexKey(from, to)) ?? [];
            },
          },
          layers.coplanarEps
        )
      : traversed
  ).map((item) => ({ item, screen: item.points.map(toScreen) }));
  // A vertex where the tree cut — what an uncut end of a crease piece still
  // carries verbatim, whichever space the cut was made in.
  const vertexAt = (vertex: number): Vec3 => cutPoints([vertex], true)[0]!;
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
    out.push(
      lineItem(
        crease,
        screen,
        item.points,
        vertexAt,
        toScreen,
        boundary,
        linesAt,
        faceOfLine[item.ref],
        isHidden
      )
    );
  });

  return { bounds, sheet, items: out };
}

/**
 * Each crease moved to follow the piece of its own triangle, where the tree
 * drew that piece after it. Everything else keeps its order.
 *
 * A crease on the line where two planes meet is coplanar with both, and the
 * tree files it under whichever plane's node it reaches first. Filed under the
 * neighbour's, it is drawn before its own face, whose antialiased edge then
 * covers half its ink — the thin-line fault the GPU avoids by drawing each
 * plane's creases after that plane's paper. Its own triangle is the one that
 * shares its two vertices — by index, not position: a buried layer's crease
 * sits at the same coordinates as the layer over it, and must not follow that
 * one — and the piece of it the crease lies on is the piece that still holds
 * both endpoints, since a cut leaves the same crossing on the face's edge as
 * on the crease. The crease goes after that piece's run of its face, so a
 * face's pieces stay consecutive for the merge, and lands over nothing the
 * piece itself is not over — the piece being nearer than everything the tree
 * drew between.
 */
function creasesAfterOwnFace(
  pieces: readonly BspItem[],
  mesh: {
    /** The source face of a face piece. */
    faceOf: (piece: BspItem) => number;
    /** The triangles (face `ref`s) that share both vertices of a crease piece. */
    ownersOf: (crease: BspItem) => readonly number[];
  },
  eps: number
): BspItem[] {
  const near = (a: Vec3, b: Vec3): boolean =>
    Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
  const holds = (piece: BspItem, point: Vec3): boolean =>
    piece.points.some((vertex) => near(vertex, point));
  // Indexed once rather than scanned per crease: a crease the tree already
  // drew after its own face has no piece to find, and scanning to the end for
  // every such crease made this pass quadratic in the pieces — seconds on a
  // deep figure, where the tree itself takes milliseconds.
  /** Where each triangle's pieces stand, in draw order. */
  const piecesOf = new Map<number, number[]>();
  /** Per face piece, the last index of the run of its face's pieces it belongs to. */
  const runEnd = new Int32Array(pieces.length);
  pieces.forEach((piece, index) => {
    if (piece.kind !== 0) return;
    const list = piecesOf.get(piece.ref);
    if (list) list.push(index);
    else piecesOf.set(piece.ref, [index]);
  });
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const piece = pieces[index]!;
    if (piece.kind !== 0) continue;
    const next = pieces[index + 1];
    const continues = next && next.kind === 0 && mesh.faceOf(next) === mesh.faceOf(piece);
    runEnd[index] = continues ? runEnd[index + 1]! : index;
  }
  /** Index of the piece each moved crease follows. */
  const after = new Map<number, number>();
  pieces.forEach((piece, index) => {
    if (piece.kind !== 1) return;
    const [a, b] = piece.points;
    if (!a || !b) return;
    let first: number | undefined;
    for (const ref of mesh.ownersOf(piece)) {
      for (const j of piecesOf.get(ref) ?? []) {
        if (j <= index || (first !== undefined && j >= first)) continue;
        const candidate = pieces[j]!;
        if (!holds(candidate, a) || !holds(candidate, b)) continue;
        first = j;
        break;
      }
    }
    if (first !== undefined) after.set(index, runEnd[first]!);
  });
  if (after.size === 0) return pieces.slice();

  const moved = new Map<number, BspItem[]>();
  for (const [crease, target] of after) {
    const list = moved.get(target) ?? [];
    list.push(pieces[crease]!);
    moved.set(target, list);
  }
  const out: BspItem[] = [];
  pieces.forEach((piece, index) => {
    if (!after.has(index)) out.push(piece);
    const following = moved.get(index);
    if (following) out.push(...following);
  });
  return out;
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

/** The triangles on each edge, keyed by the edge's vertex pair. */
function trianglesByEdge(triangles: readonly Triangle[]): Map<string, number[]> {
  const byEdge = new Map<string, number[]>();
  triangles.forEach((triangle, index) => {
    for (const [from, to] of [
      [triangle.a, triangle.b],
      [triangle.b, triangle.c],
      [triangle.c, triangle.a],
    ] as const) {
      const key = vertexKey(from, to);
      const list = byEdge.get(key);
      if (list) list.push(index);
      else byEdge.set(key, [index]);
    }
  });
  return byEdge;
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
  attributes: readonly TriangleAttributes[],
  byEdge: ReadonlyMap<string, readonly number[]>
): Array<number | undefined> {
  return creases.map((crease) => {
    let nearest: { depth: number; face: number } | undefined;
    for (const index of byEdge.get(vertexKey(crease.from, crease.to)) ?? []) {
      const depth = triangles[index]!.depth;
      if (!nearest || depth > nearest.depth) nearest = { depth, face: attributes[index]!.face };
    }
    return nearest?.face;
  });
}

function vertexKey(from: number, to: number): string {
  return from < to ? `${from}_${to}` : `${to}_${from}`;
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
  screen: readonly ScenePoint[],
  cut: readonly Vec3[],
  vertexAt: (vertex: number) => Vec3,
  toScreen: (point: Vec3) => ScenePoint,
  boundary: Uint8Array,
  linesAt: Uint32Array,
  face: number | undefined,
  hidden: boolean
): PaperLineItem {
  const role = roleOf(crease.assignment);
  // A cut leaves a piece ending mid-crease; that end is nobody's boundary, or
  // erode would open a gap where the two pieces meet. An end is the crease's
  // own only when it still carries the vertex's position in the space the tree
  // cut in, which the tree keeps verbatim for an uncut end. Not on the page:
  // under `layers` a vertex's page position is its float32 view position
  // projected, while `projected.screen` holds the projection of the float64
  // view rounded to float32, and the two differ in their last bits at any
  // real camera.
  const own = (end: 0 | 1, vertex: number) => {
    const point = cut[end]!;
    const at = vertexAt(vertex);
    return point[0] === at[0] && point[1] === at[1] && point[2] === at[2];
  };
  const flags = boundary[crease.edge] ?? 0;
  const onBoundary: [boolean, boolean] = [
    (flags & EDGE_BOUNDARY_A) !== 0,
    (flags & EDGE_BOUNDARY_B) !== 0,
  ];
  const ownsA = own(0, crease.from);
  const ownsB = own(1, crease.to);
  // A cut piece carries the crease it was cut from, for the painter to erode
  // the crease rather than the piece. Both ends project onto the straight
  // screen segment the piece lies on — a central projection keeps a line
  // straight — so the piece is a span of it.
  const whole: PaperLineWhole | undefined =
    ownsA && ownsB
      ? undefined
      : { a: toScreen(vertexAt(crease.from)), b: toScreen(vertexAt(crease.to)), onBoundary };
  // A cut end is always a joint: the rest of the crease carries on from it.
  // A vertex is one when another drawn line ends there too.
  const joinedAt = (owns: boolean, vertex: number) => !owns || (linesAt[vertex] ?? 0) > 1;
  const joined: [boolean, boolean] = [joinedAt(ownsA, crease.from), joinedAt(ownsB, crease.to)];
  return {
    kind: 'line',
    role,
    a: screen[0]!,
    b: screen[1]!,
    onBoundary: [ownsA && onBoundary[0], ownsB && onBoundary[1]],
    ...(whole ? { whole } : {}),
    ...(joined[0] || joined[1] ? { joined } : {}),
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

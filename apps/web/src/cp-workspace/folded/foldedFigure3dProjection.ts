/**
 * The 3D folded state, projected into the 2D primitive stream the crease-pattern
 * canvas already draws.
 *
 * The kernel emits a view-independent {@link OristudioCpFolded3dRenderModel} —
 * no camera, no projection, no colour. This is the whole of the other half: it
 * picks a viewpoint, resolves what covers what, decides colour, and hands back
 * an {@link OristudioCpFoldedRenderSnapshot}. Nothing downstream has to know a
 * figure is 3D. Placement, hit-testing, staleness, `.osf` and SVG/PNG export are
 * all inherited, because they read the snapshot and nothing else.
 *
 * DOM-free, store-free, React-free, and a pure function of its arguments — which
 * is what lets it be tested against real kernel payloads under bare node, where
 * a canvas cannot be.
 *
 * # Cells, not faces
 *
 * Every `BspItem` is a triangle of an **arrangement cell**, never of a face.
 * That is not an implementation detail: a cyclic panel order is legal (the
 * pinwheel fixture's fifth solution orders four arms `0 > 4 > 3 > 2 > 0`), so no
 * per-face scalar "layer" exists and nothing here may topologically sort. What
 * always exists is a winner per cell, and the kernel already computed it.
 *
 * # Two orders, two mechanisms
 *
 * The kernel's `cell_stack` is **plane-local**: it totally orders one cell's
 * faces and says nothing about plane P against plane Q. The BSP resolves exactly
 * that, and is still needed with a complete layer order, because three faces can
 * cycle in *depth* with no pair interpenetrating and because two crossing planes
 * need one drawn first over part of their overlap and second over the rest.
 *
 * The two must not fight. A cell's stack is expanded **after** traversal rather
 * than fed in as separate items, so the tree has no way to reorder it: the
 * splitter promotion in `bsp.ts` reorders coplanar items, and it does — three
 * coplanar faces pushed `a, b, c` come back `b, a, c` among straddling
 * neighbours. Across cells of one plane the kernel's `draw_rank` travels on
 * `BspItem.order`, which `sortCoplanar` honours.
 *
 * # Orthographic, in world space
 *
 * The tree is built in **world** coordinates with `edgeInk: 0`, so the build
 * never consults the eye and one tree serves any viewpoint — only the traversal
 * is camera-dependent. That is only sound orthographically: the simulator's
 * perspective is a per-vertex warp, so a segment cut in view space bends when
 * the pieces are projected separately, which would force a screen-space tree and
 * a rebuild per camera change. Orthographic also matches the flat figure this
 * sits beside on the canvas.
 */

import earcut from 'earcut';
import {
  buildBsp,
  coplanarRuns,
  findVisiblePieces,
  outlineOf,
  toViewSpace,
  traverseBsp,
  type BspItem,
  type CameraUniforms,
  type DrawnPiece,
  type RunPiece,
  type Vec3,
} from '@treemaker/origami-simulator';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_CELL_UNDETERMINED,
  FOLDED_3D_PLANE_FRAME_STRIDE,
  type OristudioCpFold3dTolerances,
  type OristudioCpFolded3dRenderModel,
  type OristudioCpFoldedFigureDisplayStyle,
  type OristudioCpFoldedFigureModel,
  type OristudioCpFoldedFigureState,
  type OristudioCpFoldedRenderPathCommand,
  type OristudioCpFoldedRenderPrimitive,
  type OristudioCpFoldedRenderSnapshot,
  type OristudioCpFoldedRenderStroke,
  type OristudioCpRgbaColor,
} from '../../engine/oristudioCpTypes';
import { CONTRADICTION_FILL } from '../adapters/cpFoldedToScene';
import type { Point } from '../../lib/geometry';

/**
 * Where the camera is, in the projector's own terms.
 *
 * At `(0, 0)` the figure is seen **face-on**, oriented exactly as the crease
 * pattern is drawn: a point of the unmoved root face lands on its own crease-
 * pattern coordinates. `yaw` then spins the figure about the paper's normal and
 * `pitch` tilts it away from face-on — the same two verbs, and the same signs,
 * as the simulator's orbit, whose paper also starts flat and facing the eye.
 */
export interface FoldedFigureCamera {
  /** Radians, about the paper's normal. */
  yaw: number;
  /**
   * Radians away from face-on; `±π/2` looks along the paper edge-on.
   *
   * **Negative** tilts the near edge down, so folds coming out of the paper rise
   * up the page — the same sign and the same reason as the simulator's
   * `DEFAULT_SIMULATOR_VIEW`. A positive pitch of the same size is a perfectly
   * good view of the same figure from underneath, which reads as the raised
   * parts drooping.
   */
  pitch: number;
  /** Model units per world unit. 1 draws the figure at crease-pattern scale. */
  zoom: number;
}

/**
 * The camera a figure is folded at: the simulator's own initial view, angle for
 * angle — 45° of spin and 54.7° of tilt is the eye on the `(1,1,1)` diagonal,
 * the "lying on a table" isometric a user of this app has already seen.
 *
 * `zoom` is 1 rather than the simulator's 1.4: there the number fits a model
 * into a viewport, here it is a scale in crease-pattern units, and 1 draws the
 * folded figure the same size as the paper it came from.
 */
export const DEFAULT_FOLDED_3D_CAMERA: FoldedFigureCamera = {
  yaw: Math.PI / 4,
  pitch: -0.955,
  zoom: 1,
};

/** Colour and lighting, in the projector's units. `[r, g, b]` in `0..1`. */
export interface Folded3dPaperStyle {
  front: readonly [number, number, number];
  back: readonly [number, number, number];
  line: readonly [number, number, number];
  /** Fill opacity, `0..1`. Below 1 disables hidden-piece culling. */
  faceAlpha: number;
  /** Java2D stroke width, in the same convention the flat kernel emits. */
  lineWidth: number;
  antiAlias: boolean;
  lighting: boolean;
  /** Light direction in **view** space, as the simulator's shader takes it. */
  lightDir: readonly [number, number, number];
}

export interface Folded3dProjectionOptions {
  camera: FoldedFigureCamera;
  displayStyle: OristudioCpFoldedFigureDisplayStyle;
  style: Folded3dPaperStyle;
  tolerances: OristudioCpFold3dTolerances;
  /** Where the figure's centroid lands, in CP model coordinates. */
  anchor?: Point;
  /** Above this many BSP items the tree is skipped. See {@link BSP_ITEM_BUDGET}. */
  itemBudget?: number;
  /** Drop pieces no pixel shows. Ignored when anything is translucent. */
  cullHidden?: boolean;
  /** Re-join BSP pieces of one cell into their outline. */
  mergeCoplanar?: boolean;
}

export interface Folded3dProjection {
  snapshot: OristudioCpFoldedRenderSnapshot;
  /**
   * Which arrangement cell each primitive came from, `-1` for a crease.
   * Index-aligned with `snapshot.primitives`.
   *
   * Carried rather than recoverable, because it is not: the tree cuts a cell
   * into pieces whose vertices exist nowhere in the payload, so nothing
   * downstream could match a primitive back to the paper it is drawing. It is
   * what a hit test on a 3D figure needs, and it is what lets a test say "each
   * cell's winner is drawn last" per cell rather than in aggregate.
   */
  cells: number[];
  /**
   * Which **face** each primitive draws, `-1` for a crease and for a cell
   * annotation. Index-aligned with `snapshot.primitives`.
   *
   * The other half of the same record. A cell says which piece of paper; a face
   * says which layer of it, which is the thing the kernel's ordering decided and
   * therefore the thing a regression has to be stated against.
   */
  faces: number[];
  /** How inter-plane depth was resolved. `depth-sorted` means the budget fired. */
  order: 'bsp' | 'depth-sorted';
  stats: {
    items: number;
    pieces: number;
    primitives: number;
    undeterminedCells: number;
  };
}

/**
 * How many `BspItem`s the tree will be built for.
 *
 * A coarse safety valve against pathological input, not a tuned threshold.
 * Measured over the admitted external corpus the worst case is
 * `origamisimulator.fold` at 6,638 items (1,628 cell triangles + 5,010 edges),
 * which builds in 9.0 ms with **zero** splits and a 41-node tree — plane-
 * clustered folded geometry does not split the way the simulator mesh this
 * builder was written for does. So the budget sits an order of magnitude above
 * anything the corpus reaches, and is expected never to fire; what it buys is
 * that a model which cannot be drawn at interactive rates degrades to a depth
 * sort instead of hanging the tab, because this runs on the main thread.
 */
export const BSP_ITEM_BUDGET = 50_000;

/** Alpha a cell's fills drop to when the solver could not order it. */
export const UNDETERMINED_FACE_ALPHA = 0.45;

/** Alpha every cell drops to under `Transparent3`. */
export const TRANSPARENT_FACE_ALPHA = 0.45;

/** The schema version the flat kernel stamps on a render snapshot. */
const RENDER_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * The stroke the flat folded figure draws its lines with
 * (`crates/oristudio-cp/src/folding.rs`, `folded_line_stroke`). Reproduced
 * rather than defaulted, because both consumers of this field — the canvas
 * (`cpFoldedToScene.ts`) and the SVG exporter (`foldedFigureSvg.ts`) — silently
 * substitute 1 for any stroke that is not `basic`, and a 3D figure drawn 17%
 * thinner than the flat figure beside it is exactly the kind of difference
 * nobody reports and nobody can explain.
 */
export function foldedLineStroke(antiAlias: boolean): OristudioCpFoldedRenderStroke {
  return {
    kind: 'basic',
    width: antiAlias ? 1.200000048 : 1.0,
    end_cap: 0,
    line_join: 0,
    miter_limit: 10.0,
  };
}

/** Paper style from a kernel figure model, so a 3D figure honours its colours. */
export function folded3dPaperStyle(model: OristudioCpFoldedFigureModel): Folded3dPaperStyle {
  return {
    front: [model.front_color.red / 255, model.front_color.green / 255, model.front_color.blue / 255],
    back: [model.back_color.red / 255, model.back_color.green / 255, model.back_color.blue / 255],
    line: [model.line_color.red / 255, model.line_color.green / 255, model.line_color.blue / 255],
    faceAlpha: 1,
    lineWidth: model.anti_alias ? 1.200000048 : 1.0,
    antiAlias: model.anti_alias,
    lighting: true,
    lightDir: [0, 0, 1],
  };
}

/**
 * How far a point may be from a plane and still count as lying in it.
 *
 * The kernel's own bar, translated into the distance `bsp.ts` compares against:
 * the offset two coplanar faces are allowed to differ by, plus the deviation a
 * tilt of `angle_radians` induces across a patch of this radius. On a span-400
 * model with the shipped defaults that is about 4.3e-4 — four thousand times
 * `bsp.ts`'s own `EPS`, and still 1e-6 of span.
 *
 * Deliberately **not** `angle_radians` itself, which the plan's first sketch
 * proposed: that quantity is an angle and the comparison it would feed is a
 * distance.
 */
export function folded3dCoplanarEpsilon(
  model: OristudioCpFolded3dRenderModel,
  tolerances: OristudioCpFold3dTolerances
): number {
  const radius = modelRadius(model);
  return tolerances.distance_relative * model.span + tolerances.angle_radians * radius;
}

/**
 * The camera a newly folded figure is shown at.
 *
 * A pure function of the payload and the requested side, so two byte-identical
 * refolds are shown identically — which is what makes a golden primitive stream
 * a stable test rather than a snapshot of one run.
 *
 * `Back1` is the antipodal eye, not a colour choice: in 3D "the other side" is
 * somewhere to stand. `Both2` has no 3D reading at all — the flat figure's
 * side-by-side pair — and falls back to the front.
 */
export function defaultFolded3dCamera(
  model: OristudioCpFolded3dRenderModel,
  side: OristudioCpFoldedFigureState = 'Front0'
): FoldedFigureCamera {
  void model;
  const base = DEFAULT_FOLDED_3D_CAMERA;
  return side === 'Back1' ? antipodalCamera(base) : { ...base };
}

/**
 * The same figure seen from exactly the other side.
 *
 * `(yaw + π, π − pitch)` and not `(yaw + π, −pitch)`: only the first negates the
 * eye direction. The second leaves the eye exactly where it was — the two
 * changes cancel — which reads as "the back view is identical to the front
 * view", a bug that looks like the camera being ignored.
 */
export function antipodalCamera(camera: FoldedFigureCamera): FoldedFigureCamera {
  return { yaw: camera.yaw + Math.PI, pitch: Math.PI - camera.pitch, zoom: camera.zoom };
}

/* --------------------------------------------------------------------------
 * Decoding — the four strides, and nothing else
 * ----------------------------------------------------------------------- */

interface PlaneFrame {
  up: Vec3;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

function planeFrame(model: OristudioCpFolded3dRenderModel, plane: number): PlaneFrame {
  const base = plane * FOLDED_3D_PLANE_FRAME_STRIDE;
  const at = (offset: number): Vec3 => [
    model.plane_frames[base + offset] ?? 0,
    model.plane_frames[base + offset + 1] ?? 0,
    model.plane_frames[base + offset + 2] ?? 0,
  ];
  return { up: at(0), origin: at(3), u: at(6), v: at(9) };
}

function cellRing(model: OristudioCpFolded3dRenderModel, cell: number): Vec3[] {
  const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
  const start = model.cell_attr[base + 1] ?? 0;
  const length = model.cell_attr[base + 2] ?? 0;
  const ring: Vec3[] = [];
  for (let i = 0; i < length; i += 1) {
    const at = (start + i) * 3;
    ring.push([model.cell_points[at] ?? 0, model.cell_points[at + 1] ?? 0, model.cell_points[at + 2] ?? 0]);
  }
  return ring;
}

function cellStack(model: OristudioCpFolded3dRenderModel, cell: number): number[] {
  const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
  const start = model.cell_attr[base + 3] ?? 0;
  const length = model.cell_attr[base + 4] ?? 0;
  return model.cell_stack.slice(start, start + length);
}

function faceNormal(model: OristudioCpFolded3dRenderModel, face: number): Vec3 {
  const at = face * 3;
  return [model.face_normals[at] ?? 0, model.face_normals[at + 1] ?? 0, model.face_normals[at + 2] ?? 0];
}

function edgeEnds(model: OristudioCpFolded3dRenderModel, edge: number): [Vec3, Vec3] {
  const at = edge * 6;
  return [
    [model.edge_points[at] ?? 0, model.edge_points[at + 1] ?? 0, model.edge_points[at + 2] ?? 0],
    [model.edge_points[at + 3] ?? 0, model.edge_points[at + 4] ?? 0, model.edge_points[at + 5] ?? 0],
  ];
}

/** Mean of every cell vertex — the point the projection is centred on. */
function modelCentroid(model: OristudioCpFolded3dRenderModel): Vec3 {
  const count = Math.floor(model.cell_points.length / 3);
  if (count === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < count; i += 1) {
    x += model.cell_points[i * 3] ?? 0;
    y += model.cell_points[i * 3 + 1] ?? 0;
    z += model.cell_points[i * 3 + 2] ?? 0;
  }
  return [x / count, y / count, z / count];
}

function modelRadius(model: OristudioCpFolded3dRenderModel): number {
  const centre = modelCentroid(model);
  let radius = 0;
  const count = Math.floor(model.cell_points.length / 3);
  for (let i = 0; i < count; i += 1) {
    radius = Math.max(
      radius,
      Math.hypot(
        (model.cell_points[i * 3] ?? 0) - centre[0],
        (model.cell_points[i * 3 + 1] ?? 0) - centre[1],
        (model.cell_points[i * 3 + 2] ?? 0) - centre[2]
      )
    );
  }
  return radius;
}

/* --------------------------------------------------------------------------
 * Camera
 * ----------------------------------------------------------------------- */

/**
 * Kernel world axes to the simulator's, so its `toViewSpace` can be reused
 * unchanged: the paper's normal becomes the simulator's vertical, which is what
 * makes `yaw` a spin in the paper's own plane and `pitch` a tilt.
 *
 * `(x, z, −y)` and not `(x, z, y)`. The second is a **reflection**, and a
 * reflected basis draws a mirrored figure with front and back swapped — which
 * looks entirely plausible, which is why it is spelled out here.
 */
function toSimBasis(p: Vec3): Vec3 {
  return [p[0], p[2], -p[1]];
}

function cameraUniformsFor(camera: FoldedFigureCamera, centre: Vec3): CameraUniforms {
  const sim = toSimBasis(centre);
  return {
    center: sim,
    cosYaw: Math.cos(camera.yaw),
    sinYaw: Math.sin(camera.yaw),
    // `pitch` is measured from face-on; the simulator's own zero is face-on too,
    // so the two agree and no offset is applied.
    cosPitch: Math.cos(camera.pitch),
    sinPitch: Math.sin(camera.pitch),
    scale: camera.zoom,
    // Zero, so `projectViewPoint`'s frame-centring term vanishes and the result
    // is in model units about the centroid rather than pixels about a viewport.
    width: 0,
    height: 0,
    depthRange: 1,
    camDist: 1,
  };
}

/**
 * World direction the eye lies in. Unit length.
 *
 * The third row of the view rotation, carried back through {@link toSimBasis}.
 * `toViewSpace` writes `depth = sinP·(−sinY·sx + cosY·sz) + cosP·sy`, so in the
 * simulator's axes the eye is `(−sinP·sinY, cosP, sinP·cosY)`; undoing
 * `(x, z, −y)` gives the components below. Getting it wrong by a sign draws the
 * figure near-to-far, which is a picture, just the wrong one.
 */
function eyeDirection(camera: FoldedFigureCamera): Vec3 {
  const sp = Math.sin(camera.pitch);
  const cp = Math.cos(camera.pitch);
  return [-sp * Math.sin(camera.yaw), -sp * Math.cos(camera.yaw), cp];
}

/**
 * Far enough that `distance(plane, eye)` is decided by the direction alone,
 * which is what makes the traversal orthographic.
 */
const ORTHOGRAPHIC_EYE_DISTANCE = 1e9;

function orthographicEye(camera: FoldedFigureCamera): Vec3 {
  const direction = eyeDirection(camera);
  return [
    direction[0] * ORTHOGRAPHIC_EYE_DISTANCE,
    direction[1] * ORTHOGRAPHIC_EYE_DISTANCE,
    direction[2] * ORTHOGRAPHIC_EYE_DISTANCE,
  ];
}

/** World point to CP model coordinates. */
function project(point: Vec3, uniforms: CameraUniforms, anchor: Point): Point {
  const sim = toSimBasis(point);
  const view = toViewSpace(sim[0], sim[1], sim[2], uniforms);
  return {
    // `projectViewPoint` with `width = height = 0` and no perspective, inlined
    // so the y negation is visible: crease-pattern model y runs **down** the
    // page (`cpModelToSvg` does not flip it) while the kernel's rings are
    // counter-clockwise in y-up paper coordinates.
    x: anchor.x + view[0] * uniforms.scale,
    y: anchor.y - view[1] * uniforms.scale,
  };
}

/** Depth of a world point: larger is nearer the eye. */
function viewDepth(point: Vec3, uniforms: CameraUniforms): number {
  const sim = toSimBasis(point);
  return toViewSpace(sim[0], sim[1], sim[2], uniforms)[2];
}

/** A direction rotated into view space — no translation, so no centre. */
function directionToView(direction: Vec3, uniforms: CameraUniforms): Vec3 {
  const sim = toSimBasis(direction);
  return toViewSpace(sim[0], sim[1], sim[2], { ...uniforms, center: [0, 0, 0] });
}

/* --------------------------------------------------------------------------
 * Shading
 * ----------------------------------------------------------------------- */

function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The face shader's flat lighting, reproduced from `svgRenderer.ts`: the
 * geometric normal in view space, oriented toward the viewer, against the light.
 *
 * Per plane rather than per triangle, because every face of a plane shares one
 * normal — which is also the point. Without it two parallel planes at different
 * depths render as one flat silhouette.
 */
function lightIntensity(viewNormal: Vec3, style: Folded3dPaperStyle): number {
  if (!style.lighting) return 1;
  const length = Math.hypot(viewNormal[0], viewNormal[1], viewNormal[2]);
  if (length < 1e-4) return 1;
  let nx = viewNormal[0] / length;
  let ny = viewNormal[1] / length;
  let nz = viewNormal[2] / length;
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const [lx, ly, lz] = style.lightDir;
  const lightLength = Math.hypot(lx, ly, lz) || 1;
  const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / lightLength);
  return Math.min(1.08, Math.max(0.68, 0.74 + diffuse * 0.3 + nz * 0.04));
}

function shade(
  color: readonly [number, number, number],
  intensity: number,
  alpha: number
): OristudioCpRgbaColor {
  return {
    red: Math.round(clampUnit(color[0] * intensity) * 255),
    green: Math.round(clampUnit(color[1] * intensity) * 255),
    blue: Math.round(clampUnit(color[2] * intensity) * 255),
    alpha: Math.round(clampUnit(alpha) * 255),
  };
}

/* --------------------------------------------------------------------------
 * Display styles
 * ----------------------------------------------------------------------- */

interface StylePlan {
  fills: boolean;
  strokes: boolean;
  /** Multiplied into every fill's alpha. */
  faceAlpha: number;
  /** Whether an undecided cell also gets its red annotation. */
  annotateUndetermined: boolean;
}

/**
 * What a display style means in 3D.
 *
 * `Transparent3` is deliberately **not** the kernel's meaning: the flat path's
 * transparency pass needs the whole-document subface arrangement
 * (`needs_subfaces`), which does not exist here. In 3D it is the honest
 * analogue — every cell translucent — which keeps the "downgrade when the layers
 * cannot be ordered" idiom expressible.
 *
 * `Development1` / `Development4` are inherited no-ops on the flat path too:
 * `push_folded_display_style_pass_primitives` has arms only for `Transparent3`
 * and `Paper5`. They draw the wireframe and no paper.
 */
function stylePlan(style: OristudioCpFoldedFigureDisplayStyle): StylePlan {
  switch (style) {
    case 'None0':
      return { fills: false, strokes: false, faceAlpha: 1, annotateUndetermined: false };
    case 'Wire2':
    case 'Development1':
    case 'Development4':
      return { fills: false, strokes: true, faceAlpha: 1, annotateUndetermined: false };
    case 'Transparent3':
      return {
        fills: true,
        strokes: true,
        faceAlpha: TRANSPARENT_FACE_ALPHA,
        annotateUndetermined: false,
      };
    case 'Paper5':
    default:
      return { fills: true, strokes: true, faceAlpha: 1, annotateUndetermined: true };
  }
}

/* --------------------------------------------------------------------------
 * The projection
 * ----------------------------------------------------------------------- */

/** One drawable thing, before it becomes a primitive. */
interface Draft {
  kind: 'fill' | 'stroke' | 'annotation';
  /** Pieces of one cell slot merge; a stroke and an unknown group never do. */
  group: number;
  /** The arrangement cell this draws, or `-1` for a crease. */
  cell: number;
  /** The face this draws, or `-1` for a crease and for an annotation. */
  face: number;
  ring: Point[];
  color: OristudioCpRgbaColor;
}

export function projectFolded3dModel(
  model: OristudioCpFolded3dRenderModel,
  options: Folded3dProjectionOptions
): Folded3dProjection {
  const anchor = options.anchor ?? { x: 0, y: 0 };
  const plan = stylePlan(options.displayStyle);
  const uniforms = cameraUniformsFor(options.camera, modelCentroid(model));
  const eye = orthographicEye(options.camera);
  const coplanarEps = folded3dCoplanarEpsilon(model, options.tolerances);

  const items = buildItems(model, plan);
  const budget = options.itemBudget ?? BSP_ITEM_BUDGET;
  let order: 'bsp' | 'depth-sorted' = 'bsp';
  let pieces: BspItem[];
  if (items.length > budget) {
    order = 'depth-sorted';
    pieces = depthSorted(items, uniforms);
  } else {
    pieces = traverseBsp(buildBsp(items, { edgeInk: 0, eye, coplanarEps }), eye);
  }

  const drafts = expand(model, pieces, plan, options.style, uniforms, anchor);
  const { primitives, cells, faces } = assemble(drafts, options);

  return {
    snapshot: {
      schema_version: RENDER_SNAPSHOT_SCHEMA_VERSION,
      fixture: null,
      pass: null,
      primitives,
    },
    cells,
    faces,
    order,
    stats: {
      items: items.length,
      pieces: pieces.length,
      primitives: primitives.length,
      undeterminedCells: model.undetermined_cells,
    },
  };
}

/**
 * What the tree is built from: one item per cell **triangle** plus one per edge.
 *
 * Exported because it is the unit the budget counts and the unit a regression
 * has to be stated in. `ref` is a cell index on a face and an edge index on an
 * edge; `order` carries the kernel's intra-plane `draw_rank`, which
 * `sortCoplanar` needs and which the tree would otherwise destroy.
 */
export function folded3dBspItems(
  model: OristudioCpFolded3dRenderModel,
  displayStyle: OristudioCpFoldedFigureDisplayStyle
): BspItem[] {
  return buildItems(model, stylePlan(displayStyle));
}

/**
 * One item per cell **triangle** plus one per edge.
 *
 * The ring is triangulated in its own plane's `(u, v)` — the frame the kernel
 * emitted, never one re-derived from a local seed, because a different tangent
 * gives a different chirality and every stack read off the projected winding
 * comes out reversed.
 */
function buildItems(model: OristudioCpFolded3dRenderModel, plan: StylePlan): BspItem[] {
  const items: BspItem[] = [];
  if (plan.fills) {
    for (let cell = 0; cell < model.cell_count; cell += 1) {
      const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
      const frame = planeFrame(model, model.cell_attr[base] ?? 0);
      const drawRank = model.cell_attr[base + 6] ?? 0;
      const ring = cellRing(model, cell);
      if (ring.length < 3) continue;
      const flat: number[] = [];
      for (const point of ring) {
        const dx = point[0] - frame.origin[0];
        const dy = point[1] - frame.origin[1];
        const dz = point[2] - frame.origin[2];
        flat.push(
          dx * frame.u[0] + dy * frame.u[1] + dz * frame.u[2],
          dx * frame.v[0] + dy * frame.v[1] + dz * frame.v[2]
        );
      }
      const indices = earcut(flat);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        items.push({
          kind: 0,
          ref: cell,
          order: drawRank,
          points: [ring[indices[i]!]!, ring[indices[i + 1]!]!, ring[indices[i + 2]!]!],
        });
      }
    }
  }
  if (plan.strokes) {
    for (let edge = 0; edge < model.edge_count; edge += 1) {
      const [a, b] = edgeEnds(model, edge);
      items.push({ kind: 1, ref: edge, points: [a, b] });
    }
  }
  return items;
}

/**
 * The fallback the budget degrades to: far-to-near by centroid depth.
 *
 * Wrong wherever a sort is wrong — which is the whole reason the tree exists —
 * but a figure that sometimes cannot be shown is the worse product, so the guard
 * refuses the *BSP* and never the figure.
 */
function depthSorted(items: BspItem[], uniforms: CameraUniforms): BspItem[] {
  const depth = (item: BspItem): number => {
    let total = 0;
    for (const point of item.points) total += viewDepth(point, uniforms);
    return total / Math.max(1, item.points.length);
  };
  return items
    .map((item, index) => ({ item, index, depth: depth(item) }))
    .sort((l, r) => l.depth - r.depth || l.item.kind - r.item.kind || l.index - r.index)
    .map((entry) => entry.item);
}

/**
 * Traversal pieces to drafts: each face piece becomes its cell's stack.
 *
 * Opaque paper shows only the top of a cell — every face of a cell covers the
 * whole cell, that being what a cell is — so exactly one fill is emitted there.
 * Translucent paper shows through, so the whole stack is emitted **bottom
 * first**, the reverse of `cell_stack`.
 */
function expand(
  model: OristudioCpFolded3dRenderModel,
  pieces: readonly BspItem[],
  plan: StylePlan,
  style: Folded3dPaperStyle,
  uniforms: CameraUniforms,
  anchor: Point
): Draft[] {
  const drafts: Draft[] = [];
  const lineColor = shade(style.line, 1, 1);
  for (const piece of pieces) {
    const ring = piece.points.map((point) => project(point, uniforms, anchor));
    if (piece.kind === 1) {
      drafts.push({ kind: 'stroke', group: -1, cell: -1, face: -1, ring, color: lineColor });
      continue;
    }
    const cell = piece.ref;
    const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    const undetermined = (model.cell_attr[base + 5] ?? 0) === FOLDED_3D_CELL_UNDETERMINED;
    const alpha =
      plan.faceAlpha * style.faceAlpha * (undetermined && plan.annotateUndetermined ? UNDETERMINED_FACE_ALPHA : 1);
    const stack = cellStack(model, cell);
    if (stack.length === 0) continue;
    const slots = alpha >= 1 ? [stack[0]!] : [...stack].reverse();
    for (let slot = 0; slot < slots.length; slot += 1) {
      const face = slots[slot]!;
      const viewNormal = directionToView(faceNormal(model, face), uniforms);
      const base3d = viewNormal[2] >= 0 ? style.front : style.back;
      drafts.push({
        kind: 'fill',
        // Slots of one cell must not merge into each other, and neither must
        // cells, so the id carries both.
        group: cell * (model.face_count + 1) + slot,
        cell,
        face,
        ring,
        color: shade(base3d, lightIntensity(viewNormal, style), alpha),
      });
    }
    if (undetermined && plan.annotateUndetermined) {
      // Per cell, an annotation, never a mode: the layers still draw and still
      // draw in a stable order, and the red says only that the solver did not
      // decide this one. The same translucent red the flat path fills a
      // contradicting face with, so the two cannot drift apart.
      drafts.push({
        kind: 'annotation',
        group: -1,
        cell,
        face: -1,
        ring,
        color: undeterminedCellColor(),
      });
    }
  }
  return drafts;
}

/** Cull, merge, and write the primitive stream. */
function assemble(
  drafts: readonly Draft[],
  options: Folded3dProjectionOptions
): { primitives: OristudioCpFoldedRenderPrimitive[]; cells: number[]; faces: number[] } {
  const opaque = drafts.every((draft) => draft.kind === 'stroke' || draft.color.alpha >= 255);
  const survivors =
    options.cullHidden !== false && opaque ? cull(drafts, options.style.lineWidth) : [...drafts];
  const merged = options.mergeCoplanar === false ? survivors : merge(survivors);

  const stroke = foldedLineStroke(options.style.antiAlias);
  const antialias = options.style.antiAlias ? 'on' : 'off';
  const primitives: OristudioCpFoldedRenderPrimitive[] = [];
  const cells: number[] = [];
  const faces: number[] = [];
  for (const draft of merged) {
    const isStroke = draft.kind === 'stroke';
    primitives.push({
      sequence: primitives.length,
      kind: isStroke ? 'stroke_path' : draft.kind === 'annotation' ? 'fill_polygon' : 'fill_path',
      style: { paint: { kind: 'color', color: draft.color }, stroke, antialias },
      geometry:
        draft.kind === 'annotation'
          ? { kind: 'polygon', points: [...draft.ring] }
          : { kind: 'path', commands: pathCommands(draft.ring, !isStroke) },
    });
    cells.push(draft.cell);
    faces.push(draft.face);
  }
  return { primitives, cells, faces };
}

/**
 * Drop drafts no sample of the page shows.
 *
 * Only sound while every piece is opaque — translucent paper showing what is
 * under it is the whole point of it — which is the same rule the SVG exporter
 * applies, and for the same reason.
 */
function cull(drafts: readonly Draft[], lineWidth: number): Draft[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const draft of drafts) {
    for (const point of draft.ring) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }
  if (!Number.isFinite(minX)) return [...drafts];
  const drawn: DrawnPiece[] = drafts.map((draft) => ({
    points: draft.ring.map((point) => [point.x, point.y] as const),
    strokeWidth: draft.kind === 'stroke' ? lineWidth : 0,
  }));
  const visible = findVisiblePieces(drawn, {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  });
  return drafts.filter((_, index) => visible[index]);
}

/**
 * Re-join consecutive pieces of one cell slot into their outline.
 *
 * Consecutive only, and that is the whole of why it is sound: replacing a run
 * with its outline draws that area at the run's position, and nothing is drawn
 * between two consecutive pieces to repaint over.
 */
function merge(drafts: readonly Draft[]): Draft[] {
  const pieces: RunPiece[] = drafts.map((draft) => ({
    group: draft.kind === 'stroke' ? -1 : draft.group,
    fill: `${draft.color.red},${draft.color.green},${draft.color.blue},${draft.color.alpha}`,
    points: draft.ring.map((point) => [point.x, point.y] as const),
  }));
  const runs = coplanarRuns(pieces);
  if (runs.length === 0) return [...drafts];

  const out: Draft[] = [];
  let cursor = 0;
  for (const [start, end] of runs) {
    for (; cursor < start; cursor += 1) out.push(drafts[cursor]!);
    const outline = outlineOf(pieces.slice(start, end).map((piece) => piece.points));
    if (outline) {
      out.push({ ...drafts[start]!, ring: outline.map(([x, y]) => ({ x, y })) });
    } else {
      for (let i = start; i < end; i += 1) out.push(drafts[i]!);
    }
    cursor = end;
  }
  for (; cursor < drafts.length; cursor += 1) out.push(drafts[cursor]!);
  return out;
}

function pathCommands(ring: readonly Point[], close: boolean): OristudioCpFoldedRenderPathCommand[] {
  const commands: OristudioCpFoldedRenderPathCommand[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const point = ring[i]!;
    commands.push(i === 0 ? { command: 'move_to', point } : { command: 'line_to', point });
  }
  if (close && commands.length > 0) commands.push({ command: 'close' });
  return commands;
}

/** The translucent red an undecided cell is annotated with, as a paint colour. */
export function undeterminedCellColor(): OristudioCpRgbaColor {
  return {
    red: Math.round(CONTRADICTION_FILL[0] * 255),
    green: Math.round(CONTRADICTION_FILL[1] * 255),
    blue: Math.round(CONTRADICTION_FILL[2] * 255),
    alpha: Math.round(CONTRADICTION_FILL[3] * 255),
  };
}

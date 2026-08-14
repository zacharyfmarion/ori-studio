/**
 * What it takes to draw a 3D folded figure as a window rather than as a picture
 * in the crease-pattern scene.
 *
 * Pure and React-free: the predicate, the camera, the appearance and the
 * worker payload. It is one module because the predicate has three consumers
 * that must not disagree —
 *
 * - the window layer, which decides which figures get a window;
 * - the crease-pattern canvas, which must stop drawing exactly those figures
 *   (drawn in both places they would overlap, at slightly different sizes);
 * - the orbit gesture, which must stop re-projecting exactly those figures,
 *   since the projection it computes is no longer what anybody draws.
 *
 * Three copies of that condition is three chances for a figure to be drawn twice
 * or not at all.
 */

import {
  DEFAULT_CREASE_DEPTH_BIAS,
  fitExtent,
  type OrbitView,
  type RenderSettings,
} from '@treemaker/origami-simulator';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import type { Folded3dMeshPayload } from '../../simulator/foldedMeshSource';
import { clampSimulatorZoom } from '../../lib/simulatorOrbit';
import { isFolded3dFigure } from './foldedFigureCapabilities';
import { folded3dRenderModel } from './folded3dRenderModels';
import {
  FOLDED_3D_MESH_VERTEX_BUDGET,
  folded3dMeshExtent,
  packFolded3dPositionTexture,
  type Folded3dMesh,
} from './folded3dMesh';
import {
  UNDETERMINED_FACE_ALPHA,
  folded3dStylePlan,
  type Folded3dPaperStyle,
} from './folded3dStyle';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './foldedFigure3dProjection';

/**
 * Whether this figure can be drawn as a live window right now.
 *
 * Four conditions, each of which sends the figure back to exactly the path it is
 * on today — its stored `renderSnapshot`, drawn in the crease-pattern scene:
 *
 * - **It is a 3D figure.** The flat figure does not change, in any respect.
 * - **The GPU path is available.** Without WebGL2 there is nothing to draw a
 *   mesh with, and the scene's picture is perfectly good — better than an inline
 *   simulation's answer, which is an empty box and a badge, because a folded
 *   figure has a correct picture already.
 * - **Its render model is still here.** A figure reopened from a file has
 *   `handle: null` and no geometry to mesh; making that live is Phase 5's job.
 * - **It has a frame.** Without `frameRadius` the figure's box is the bounds of
 *   whatever the projection last produced, which change on every orbit frame. As
 *   a scene primitive that only made the chrome jump; as a **window** it would
 *   be a per-frame layout write, waking the canvas's `ResizeObserver` and
 *   re-rendering — precisely the 640-bitmaps-a-second failure the placement
 *   module exists to prevent.
 *
 * The vertex budget is checked from {@link folded3dMeshExtent}, which is an
 * integer pass over the cell table rather than a mesh build, so this stays cheap
 * enough to evaluate for every figure on every document revision.
 */
export function canWindowFolded3dFigure(
  figure: OristudioCpFoldedFigureEntry,
  options: { gpuAvailable: boolean }
): boolean {
  if (!options.gpuAvailable) return false;
  if (!isFolded3dFigure(figure)) return false;
  if (figure.frameRadius == null || figure.frameRadius <= 0) return false;
  const model = folded3dRenderModel(figure.handle);
  if (!model) return false;
  return folded3dMeshExtent(model).vertexCount <= FOLDED_3D_MESH_VERTEX_BUDGET;
}

/** The figures that get a window, as a set the scene can subtract. */
export function folded3dWindowIds(
  figures: readonly OristudioCpFoldedFigureEntry[],
  options: { gpuAvailable: boolean }
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const figure of figures) {
    if (canWindowFolded3dFigure(figure, options)) ids.add(figure.id);
  }
  return ids;
}

/**
 * Zoom that makes the model exactly fill the window it is drawn in.
 *
 * `cameraUniforms` fits a model to `fitExtent`, which is the short edge less 8%
 * on each side — right for a resizable viewport, wrong for a window whose size
 * *is* the model's frame. A figure's frame is `2 · modelRadius` and the window is
 * sized from it, so the bounding circle already touches the edge; leaving the
 * padding in would draw every existing 3D figure about 16% smaller inside the
 * same box, which is a visible change nobody asked for.
 *
 * The figure's own zoom multiplies this rather than replacing it, so zoom 1
 * means "fills the window" at any window size.
 *
 * Derived from `fitExtent` rather than from its constant, so it stays exact if
 * the padding is ever retuned.
 */
export function folded3dFrameFillZoom(width: number, height: number): number {
  const shortEdge = Math.min(width, height);
  const extent = fitExtent(width, height);
  return extent > 0 ? shortEdge / extent : 1;
}

/**
 * The figure's viewpoint as the mesh renderer's orbit view.
 *
 * All three fields, including `zoom` — this is the one place a folded figure's
 * zoom is honoured. The frame it is drawn in is the model's bounding sphere and
 * does not move with the eye (`folded3dFrameRadius`), so zooming makes the
 * model bigger *inside* a window of fixed size, and the window's `overflow`
 * crops whatever leaves it. The window's own size is the canvas handles. Those
 * two scales are the split an inline simulation already has between its wheel
 * and its resize handles, and keeping them apart is what stops a zoom from
 * turning into a resize.
 *
 * Clamped to the range the simulator viewport's own wheel clamps to, so a stored
 * camera cannot put a figure somewhere its gestures could not.
 */
export function folded3dWindowView(camera: FoldedFigureCamera | null | undefined): OrbitView {
  const source = camera ?? DEFAULT_FOLDED_3D_CAMERA;
  return {
    yaw: source.yaw,
    pitch: source.pitch,
    zoom: clampSimulatorZoom(source.zoom),
  };
}

/**
 * Crease weight in a window, in device pixels before the frame shrink.
 *
 * Calibration, not physics — the same kind of number as the inline simulation's
 * crease reference edge, and expected to be tuned on sight. The projector draws
 * its lines in user units scaled by the figure's placement, which has no exact
 * device-pixel equivalent, so this picks a weight that reads as linework at a
 * normal window size and shrinks with the window from there.
 */
export const FOLDED_3D_WINDOW_CREASE_WIDTH_PX = 1.5;

/**
 * How much of one layer gap a crease is allowed to float above its own paper.
 *
 * The bias exists to break a tie — a crease is drawn from its slot's own ring,
 * so it is exactly coplanar with the face it bounds and would otherwise
 * z-fight. A quarter of a gap settles that with three quarters of margin left,
 * and, far more importantly, **cannot reach the next layer**. The whole
 * occlusion bug was a bias that could: the shipped constant is a dozen gaps
 * deep, so every buried layer's creases rode it to the front.
 */
export const FOLDED_3D_CREASE_BIAS_FRACTION = 0.25;

/**
 * The crease depth bias for a folded figure, in NDC z.
 *
 * Camera-independent, which is what lets it be a render *setting* rather than
 * something recomputed per frame: `cameraUniforms` sets `depthRange` to twice
 * the radius it is given, and the window gives it `mesh.radius`, so a fraction
 * of `mesh.eps` in world depth is that same fraction of `eps / (2 · radius)` in
 * NDC whatever the eye is doing.
 *
 * The number that comes out is small — 2.5e-5 for a shallow stack, 7.7e-6 at the
 * corpus's deepest (`plant_penguin`, 14 layers) — which is 210 and 64 units of a
 * 24-bit depth buffer and under one of a 16-bit one. That is the same cliff
 * `Folded3dMeshRuntime.shallowDepthBuffer` already reports, and it is why it
 * reports it.
 */
export function folded3dCreaseDepthBias(mesh: Pick<Folded3dMesh, 'eps' | 'radius'>): number {
  if (!(mesh.radius > 0)) return DEFAULT_CREASE_DEPTH_BIAS;
  return (FOLDED_3D_CREASE_BIAS_FRACTION * mesh.eps) / (2 * mesh.radius);
}

/**
 * How a 3D figure's paper is drawn, as the settings every renderer takes.
 *
 * Built from the figure's **own** model colours rather than from the app-wide
 * simulator settings, because they are document state: the same numbers the flat
 * figure beside it draws with, and the same ones `folded3dPaperStyle` gives the
 * projector. A figure whose colours followed the Simulate workspace's would both
 * ignore what the user set on it and change what those settings mean.
 *
 * All three crease colours are the figure's one line colour, which reproduces
 * today's single-ink linework exactly. The mesh does carry mountain/valley
 * codes, so telling them apart is a colour change away — but that is a new
 * appearance, not this phase.
 */
export function folded3dWindowRenderSettings(options: {
  style: Folded3dPaperStyle;
  displayStyle: OristudioCpFoldedFigureDisplayStyle;
  devicePixelRatio: number;
  /**
   * The mesh being drawn, for {@link folded3dCreaseDepthBias}.
   *
   * Optional only so a caller with no mesh yet still gets colours; without it
   * the creases fall back to the renderer's own bias, which on a folded figure
   * is deep enough to draw buried layers.
   */
  mesh?: Pick<Folded3dMesh, 'eps' | 'radius'> | null;
}): RenderSettings {
  const { style, displayStyle } = options;
  const plan = folded3dStylePlan(displayStyle, style.transparentAlpha);
  const line: [number, number, number] = [style.line[0], style.line[1], style.line[2]];
  return {
    frontColor: [style.front[0], style.front[1], style.front[2]],
    backColor: [style.back[0], style.back[1], style.back[2]],
    mountainColor: line,
    valleyColor: line,
    borderColor: line,
    lightDir: [style.lightDir[0], style.lightDir[1], style.lightDir[2]],
    // Never painted: the window sits on the crease pattern, and an opaque
    // backdrop reads as a hole punched in the drawing rather than a view onto
    // it. The viewport re-asserts this from `transparentBackground` anyway.
    background: [0, 0, 0],
    backgroundAlpha: 0,
    showFaces: plan.fills,
    showEdges: plan.strokes,
    lighting: style.lighting,
    creaseWidthPx: Math.max(
      0.5,
      FOLDED_3D_WINDOW_CREASE_WIDTH_PX * Math.max(1, options.devicePixelRatio)
    ),
    faceAlpha: plan.faceAlpha * style.faceAlpha,
    creaseDepthBias: options.mesh ? folded3dCreaseDepthBias(options.mesh) : undefined,
  };
}

/**
 * The mesh in the form the worker takes it, with the buffers to transfer.
 *
 * Every buffer is a **copy**. Transferring the mesh's own arrays would detach
 * them, and the mesh has to survive: an evicted figure reloads from it, and
 * Phase 6's vector export reads the same positions.
 */
export function folded3dMeshPayload(mesh: Folded3dMesh): {
  payload: Folded3dMeshPayload;
  transferables: ArrayBuffer[];
} {
  const positions = packFolded3dPositionTexture(mesh.positions, mesh.topology.textureDim);
  const faceIndices = mesh.topology.faceIndices.slice();
  const edgeIndices = mesh.topology.edgeIndices.slice();
  const edgeAssignments = mesh.topology.edgeAssignments.slice();
  const payload: Folded3dMeshPayload = {
    positions: positions.buffer as ArrayBuffer,
    textureDim: mesh.topology.textureDim,
    vertexCount: Math.floor(mesh.positions.length / 3),
    faceIndices: faceIndices.buffer as ArrayBuffer,
    edgeIndices: edgeIndices.buffer as ArrayBuffer,
    edgeAssignments: edgeAssignments.buffer as ArrayBuffer,
    center: mesh.center,
    radius: mesh.radius,
    undeterminedIndexStart: mesh.undeterminedIndexStart,
    undeterminedEdgeStart: mesh.undeterminedEdgeStart,
    undeterminedFaceAlpha: UNDETERMINED_FACE_ALPHA,
  };
  return {
    payload,
    transferables: [
      payload.positions,
      payload.faceIndices,
      payload.edgeIndices,
      payload.edgeAssignments,
    ],
  };
}

/** The render model a figure would be meshed from, or undefined. */
export function folded3dFigureModel(
  figure: OristudioCpFoldedFigureEntry
): OristudioCpFolded3dRenderModel | undefined {
  return folded3dRenderModel(figure.handle);
}

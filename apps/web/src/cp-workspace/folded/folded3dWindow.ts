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
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, resolvePaperStyle } from '../../lib/paper/paperStyleResolve';
import { clampSimulatorZoom } from '../../lib/simulatorOrbit';
import { isFolded3dFigure } from './foldedFigureCapabilities';
import { folded3dRenderModel } from './folded3dRenderModels';
import {
  FOLDED_3D_MESH_VERTEX_BUDGET,
  folded3dMeshExtent,
  packFolded3dPositionTexture,
  type Folded3dMesh,
} from './folded3dMesh';
import { FOLDED_3D_SILHOUETTE_FACTOR } from './folded3dFrame';
import { UNDETERMINED_FACE_ALPHA, folded3dStylePlan } from './folded3dStyle';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './folded3dCamera';

/**
 * Whether this figure can be drawn as a live window right now.
 *
 * Four conditions, each of which sends the figure back to exactly the path it is
 * on today — its stored `PaperScene`, drawn in the crease-pattern scene:
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
 * *is* the model's frame. A figure's frame is `2 · folded3dFrameHalfSide` and
 * the window is sized from it, so the bounding circle's perspective
 * silhouette already touches the edge; leaving the padding in would draw
 * every existing 3D figure about 16% smaller inside the same box, which is a
 * visible change nobody asked for.
 *
 * The silhouette factor divides out for the same reason: `cameraUniforms`
 * fits the sphere's *radius* to the extent, and the frame is the silhouette,
 * so fitting the radius to the whole short edge would draw the model 5%
 * larger than its frame's units say and let its silhouette leave the box.
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
  return extent > 0 ? shortEdge / extent / FOLDED_3D_SILHOUETTE_FACTOR : 1;
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
    orient: source.orient,
  };
}

/**
 * How far toward the viewer a crease is pushed, in NDC z.
 *
 * A tie-break and nothing more. A crease is drawn from its own layer's ring, and
 * an opaque figure draws one layer per cell, so the only thing a crease is ever
 * coincident with is **the single face it lies on**. It has to beat zero, not a
 * stack.
 *
 * It does **not** have to clear another plane that meets this one along a fold
 * line, which is the job it kept being handed and kept failing at: a fold line
 * lies in both planes at once, so no epsilon separates them at every camera.
 * That is settled by drawing the planes far-to-near and letting the nearer one's
 * paper cover the farther one's linework — see `folded3dDrawPasses`.
 *
 * So all this has left to beat is the *slope* of its own face across the width of
 * the crease ribbon, which is why it can be this small: `2e-5 · radius` of world
 * depth, still 84 units of a 24-bit depth buffer. On a 16-bit one it is a third
 * of a unit, which is what `Folded3dMeshRuntime.shallowDepthBuffer` reports.
 */
export const FOLDED_3D_CREASE_DEPTH_BIAS = 1e-5;

/**
 * How a 3D figure's paper is drawn, as the settings every renderer takes.
 *
 * Built from the figure's **effective paper style** — the app's display style
 * with the figure's own pins on top (`effectiveObjectPaperStyle`) — through
 * the `folded-3d` policy: paper colours, the edge, fold and aux pens, erode
 * and the light. A 3D figure draws its creases as the simulator does: the M/V
 * pens by fold sign, the edge pen for borders, the aux pen for a 0° fold when
 * the style shows aux creases — under the resolver's one-width rule, every
 * fold line at the mountain pen's width (`surfacePaperStyle`).
 *
 * The pens' widths reach the GPU in device pixels through the resolver
 * (`ptToDevicePx`), and the frame shrink below the reference edge is the
 * viewport's to apply (`creaseWidthReferenceEdge`, see `Folded3dWindowLayer`).
 * The light direction is data from the style, shared with the simulator, so
 * the two surfaces are lit from the same place.
 */
export function folded3dWindowRenderSettings(options: {
  style: PaperStyle;
  displayStyle: OristudioCpFoldedFigureDisplayStyle;
  devicePixelRatio: number;
}): RenderSettings {
  const plan = folded3dStylePlan(options.displayStyle);
  return {
    ...resolvePaperStyle(options.style, PAPER_STYLE_POLICIES['folded-3d'], {
      dpr: options.devicePixelRatio,
      // Never painted: the window sits on the crease pattern, and an opaque
      // backdrop reads as a hole punched in the drawing rather than a view onto
      // it. The viewport re-asserts this from `transparentBackground` anyway.
      background: [0, 0, 0],
      backgroundAlpha: 0,
      faceAlpha: plan.faceAlpha,
      colorMode: 'paper',
      strainClip: 0,
      showFaces: plan.fills,
      showEdges: plan.strokes,
    }),
    creaseDepthBias: FOLDED_3D_CREASE_DEPTH_BIAS,
    // A nearer plane's paper has to be able to cover a farther plane's creases
    // where the two meet along a fold line — see `RenderSettings`.
    creaseWritesDepth: false,
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
  const auxEnds = mesh.topology.auxEnds?.slice() ?? new Uint8Array(edgeAssignments.length);
  const payload: Folded3dMeshPayload = {
    positions: positions.buffer as ArrayBuffer,
    textureDim: mesh.topology.textureDim,
    vertexCount: Math.floor(mesh.positions.length / 3),
    faceIndices: faceIndices.buffer as ArrayBuffer,
    edgeIndices: edgeIndices.buffer as ArrayBuffer,
    edgeAssignments: edgeAssignments.buffer as ArrayBuffer,
    auxEnds: auxEnds.buffer as ArrayBuffer,
    center: mesh.center,
    radius: mesh.radius,
    sheet: mesh.sheet,
    skins: mesh.skins,
    translucent: mesh.translucent,
    undetermined: mesh.undetermined,
    undeterminedFaceAlpha: UNDETERMINED_FACE_ALPHA,
  };
  return {
    payload,
    transferables: [
      payload.positions,
      payload.faceIndices,
      payload.edgeIndices,
      payload.edgeAssignments,
      payload.auxEnds,
    ],
  };
}

/** The render model a figure would be meshed from, or undefined. */
export function folded3dFigureModel(
  figure: OristudioCpFoldedFigureEntry
): OristudioCpFolded3dRenderModel | undefined {
  return folded3dRenderModel(figure.handle);
}

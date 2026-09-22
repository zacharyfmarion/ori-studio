/**
 * The 3D folded figure's picture as a {@link PaperScene}: the window's own
 * mesh, through the simulator's scene producer, at the camera the window shows.
 *
 * What the export used to draw was a second builder of the same geometry — the
 * CPU projector — with its own cull, merge and camera, and the 3 + 22 pinned
 * camera disagreements in `folded3dProjectorParity.test.ts` are what two
 * builders cost. This module builds nothing: it hands `meshToPaperScene` the
 * buffers `FoldedMeshSource` uploads, plus the three facts the tree cannot
 * recover from them — which kernel face each triangle draws, where each layer
 * sits in its cell's stack at this camera, and which creases the window would
 * draw — and the picture is the window's by construction (D5, D7).
 *
 * # Every layer, ordered
 *
 * The window draws one *skin* per plane: the layer of each cell nearest the
 * eye. The scene takes the mesh's translucent range instead — every layer of
 * every determined cell, once — so buried paper exists for a painter that keeps
 * hidden faces (D4), and says where each layer sits through `order`: the layer
 * the skin would show at rank 0, the one beneath it at rank 1, and so on, with
 * a layer's creases ordered past every face of that layer. Under
 * `meshToPaperScene`'s `layers` mode the tree sorts a plane's coplanar node by
 * exactly that, so a buried layer's creases are drawn over the buried layer and
 * under the one that covers them — and come out marked hidden, never drawn on
 * top of paper the window shows. Which end of a cell's stack is "near" is
 * `up · eye` for the cell's plane, the same bit `folded3dDrawPasses` picks a
 * skin with.
 *
 * # The creases the window draws, and the ones it does not
 *
 * Every layer's creases come from the translucent run, each hinge under the
 * rule the window admits a skin's hinge groups by: drawn only when the plane
 * on the far side of the bend shows the side the bend is exposed on. For the
 * layer a skin shows that is precisely the window's set at this camera. For
 * a buried layer it is what keeps a bend the window hides from showing its
 * outer half past the paper (`sceneTopology` says why); the price is that
 * uncovering a buried layer in an editor reveals it without those bends.
 *
 * # Side, shade, sheet
 *
 * The side of the paper a triangle shows is read off its screen winding, as the
 * GPU's `gl_FrontFacing` reads it: `folded3dMesh` winds every triangle so that
 * the GPU paints the kernel's front where the kernel says front (its header
 * says how), and the scene reads the same winding through the same projection,
 * so a second statement of the side here could only disagree. Shade is the
 * simulator's `shadeFor` under the figure's effective light through the
 * `folded-3d` policy — the same light the window's `RenderSettings` carry. The
 * sheet is the mesh's (`model.span`, the longer side of the unfolded bounding
 * box in the kernel's units, which the mesh positions are in), the same number
 * the window's edge pass erodes by.
 */

import {
  cameraUniforms,
  meshToPaperScene,
  viewDepthAxis,
  type CameraUniforms,
  type PaperScene,
  type SvgMeshTopology,
} from '@treemaker/origami-simulator';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_CELL_UNDETERMINED,
  type OristudioCpFold3dTolerances,
  type OristudioCpFolded3dRenderModel,
  type OristudioCpFoldedFigureDisplayStyle,
  type OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import {
  PAPER_STYLE_POLICIES,
  lightVector,
  surfacePaperStyle,
} from '../../lib/paper/paperStyleResolve';
import { widestPenCssPx } from '../../lib/paper/paperSvg';
import { foldedFigureBox } from '../adapters/cpFoldedToScene';
import { toSimBasis, type Folded3dMesh } from './folded3dMesh';
import { planeFrame } from './folded3dModelReader';
import { folded3dStylePlan } from './folded3dStyle';
import { folded3dFrameFillZoom, folded3dWindowView } from './folded3dWindow';
import { folded3dCoplanarEpsilon, type FoldedFigureCamera } from './foldedFigure3dProjection';

export interface Folded3dPaperSceneOptions {
  /**
   * The figure's effective paper style — the app's export or display style
   * with the figure's own pins on top. The `folded-3d` policy is applied here,
   * as the window applies it, so the scene is lit and coloured as the window is.
   */
  style: PaperStyle;
  /** Mark the pieces nothing shows; off when the page keeps them anyway. */
  markHidden: boolean;
  /** The kernel's tolerances the figure was folded under: `folded3d.diagnostics.tolerances`. */
  tolerances: OristudioCpFold3dTolerances;
  /**
   * What the figure draws — paper and creases, creases alone, or nothing.
   * `Paper5` when absent. A translucent style has no scene form and exports as
   * opaque paper, every layer kept.
   */
  displayStyle?: OristudioCpFoldedFigureDisplayStyle;
}

/**
 * The scene the figure's window shows at `camera`, every layer included.
 *
 * `mesh` is `folded3dMesh(model)` — the buffers the window uploads — and
 * `camera` is {@link folded3dSceneCamera} for the figure's stored orbit, so
 * scene px are the window's CSS px.
 */
export function folded3dPaperScene(
  mesh: Folded3dMesh,
  model: OristudioCpFolded3dRenderModel,
  camera: CameraUniforms,
  options: Folded3dPaperSceneOptions
): PaperScene {
  const style = surfacePaperStyle(options.style, PAPER_STYLE_POLICIES['folded-3d']);
  const plan = folded3dStylePlan(options.displayStyle ?? 'Paper5');
  const layers = slotRanks(mesh, model, camera);
  const geometry = sceneTopology(mesh, model, layers, {
    // A wireframe draws no paper, so nothing can bury a crease and the window
    // draws only the skins' creases; the buried layers' would all show.
    buriedLayers: plan.fills,
    creases: plan.strokes,
  });
  return meshToPaperScene(mesh.positions, geometry.topology, camera, {
    sheet: mesh.sheet,
    perspective: true,
    markHidden: options.markHidden,
    lighting: style.light.enabled,
    lightDir: lightVector(style.light.azimuth, style.light.elevation),
    faceGroups: geometry.faceGroups,
    order: geometry.order,
    edgeOrder: geometry.edgeOrder,
    lineWidth: widestPenCssPx(style),
    // The kernel's own bar, in the world units the tree cuts in under
    // `layers`: four thousand times the tree's default, and what keeps a plane
    // the kernel joined from being split by float rounding — the projector's
    // reasoning, unchanged.
    layers: { coplanarEps: folded3dCoplanarEpsilon(model, options.tolerances) },
    showFaces: plan.fills,
    showEdges: plan.strokes,
  });
}

/**
 * The window's camera for a figure, in CSS px: the stored orbit through
 * `folded3dWindowView` (zoom clamped as the wheel clamps it), the fill zoom
 * that makes the model's perspective silhouette exactly fill its frame, and the
 * mesh's own centre and radius — the four numbers `Folded3dWindowLayer` hands
 * `setCamera`, with the box side in CSS px where the window passes device px.
 * So the scene's orientation and framing are the window's, and its px are the
 * window's CSS px whatever the display's ratio.
 *
 * `boxCssPx` is the figure's on-screen box ({@link folded3dFigureBoxCssPx}),
 * square by construction.
 */
export function folded3dSceneCamera(
  camera: FoldedFigureCamera | null | undefined,
  mesh: Pick<Folded3dMesh, 'center' | 'radius'>,
  boxCssPx: number
): CameraUniforms {
  const view = folded3dWindowView(camera);
  const side = Math.max(1, boxCssPx);
  return cameraUniforms(
    { ...view, zoom: view.zoom * folded3dFrameFillZoom(side, side) },
    mesh.center,
    mesh.radius,
    side,
    side
  );
}

/**
 * The side of a figure's box in CSS px at a crease-pattern camera whose user
 * space is `cssPerUserUnit` px per unit — 1 at the canvas's 100%, which is the
 * box at zoom 1 when no canvas is mounted. The same box the window is sized
 * from (`foldedFigureBox`, the frame from the figure's `frameRadius`); null
 * when the figure has none.
 */
export function folded3dFigureBoxCssPx(
  figure: OristudioCpFoldedFigureEntry,
  cssPerUserUnit = 1
): number | null {
  const box = foldedFigureBox(figure);
  if (!box) return null;
  const side = Math.min(box.width, box.height) * cssPerUserUnit;
  return Number.isFinite(side) && side > 0 ? side : null;
}

/** Which end of every stack the eye is on, and where each slot sits from it. */
interface SlotRanks {
  /** Per plane: whether its `up` points toward the eye, so `cell_stack[0]` is nearest. */
  upTowardEye: boolean[];
  /** Per slot: its distance from the near end of its cell's stack; 0 is the layer a skin shows. */
  ranks: Int32Array;
}

function slotRanks(
  mesh: Folded3dMesh,
  model: OristudioCpFolded3dRenderModel,
  camera: CameraUniforms
): SlotRanks {
  const axis = viewDepthAxis(camera.rotation);
  // One dot product per plane — the test `folded3dDrawPasses` selects a skin
  // with, on the same vector in the same basis.
  const upTowardEye: boolean[] = [];
  for (let plane = 0; plane < model.plane_count; plane += 1) {
    const up = toSimBasis(planeFrame(model, plane).up);
    upTowardEye.push(up[0] * axis[0] + up[1] * axis[1] + up[2] * axis[2] >= 0);
  }
  const ranks = new Int32Array(mesh.slots.count);
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    const cell = mesh.slots.cell[slot]!;
    const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    const stackLength = model.cell_attr[base + 4] ?? 0;
    const depth = mesh.slots.depth[slot]!;
    ranks[slot] = upTowardEye[model.cell_attr[base] ?? 0] ? depth : stackLength - 1 - depth;
  }
  return { upTowardEye, ranks };
}

/** The scene's own view of the mesh: the layers it draws and their order. */
interface SceneTopology {
  topology: SvgMeshTopology;
  /** Kernel face per triangle. */
  faceGroups: Int32Array;
  /** Coplanar order per triangle. */
  order: Float64Array;
  /** Coplanar order per crease. */
  edgeOrder: Float64Array;
}

function sceneTopology(
  mesh: Folded3dMesh,
  model: OristudioCpFolded3dRenderModel,
  { upTowardEye, ranks }: SlotRanks,
  include: { buriedLayers: boolean; creases: boolean }
): SceneTopology {
  const { slots, topology } = mesh;
  // Orders are laid out in bands, one per rank, nearer ranks higher: a rank's
  // faces by kernel face id, so a face's pieces across the cells of one plane
  // are adjacent for the merge, and then that rank's creases past all of them,
  // so within a layer paper still comes before ink.
  const band = model.face_count + 1;
  const faceOrder = (rank: number, face: number): number => -rank * band + face;
  const creaseOrder = (rank: number): number => -rank * band + model.face_count;

  // --- faces: every layer once, from the translucent and undetermined runs --
  const faceStart = mesh.translucent.faceIndexStart;
  const faceEnd = mesh.undetermined.faceIndexStart + mesh.undetermined.faceIndexCount;
  const faceIndices = topology.faceIndices.subarray(faceStart, faceEnd);
  const triangleCount = Math.floor(faceIndices.length / 3);
  const faceGroups = new Int32Array(triangleCount).fill(-1);
  const order = new Float64Array(triangleCount);
  for (let slot = 0; slot < slots.count; slot += 1) {
    const first = (slots.indexStart[slot]! - faceStart) / 3;
    const last = (slots.indexStart[slot + 1]! - faceStart) / 3;
    const face = slots.face[slot]!;
    const rank = ranks[slot]!;
    for (let triangle = first; triangle < last; triangle += 1) {
      faceGroups[triangle] = face;
      order[triangle] = faceOrder(rank, face);
    }
  }

  // --- creases ------------------------------------------------------------
  const edgeIndices: number[] = [];
  const edgeAssignments: number[] = [];
  const edgeOrder: number[] = [];
  const take = (edge: number, rank: number): void => {
    edgeIndices.push(topology.edgeIndices[edge * 2]!, topology.edgeIndices[edge * 2 + 1]!);
    edgeAssignments.push(topology.edgeAssignments[edge]!);
    edgeOrder.push(creaseOrder(rank));
  };
  if (include.creases) {
    // The fallback: model edges no layer inked, drawn plainly as the window
    // draws them. Expected empty.
    for (let edge = 0; edge < mesh.fallbackEdgeCount; edge += 1) take(edge, 0);

    // Every layer's creases, from the run that has all of them, each under the
    // window's rule for its hinges: a bend is drawn only when the plane on its
    // far side shows the side the bend is exposed on (`folded3dDrawPasses`
    // admits a skin's hinge groups by exactly this). The rule holds for a
    // buried layer too — the layer covering it inks the same segment only as
    // a hinge of its own, under the same condition, so an unadmitted bend
    // would show its outer half past the paper where the window draws none.
    // A cell the solver could not order is drawn whole, hinges and all, as
    // the window's translucent pass draws it.
    const planeShowsSide = (plane: number, side: number): boolean =>
      side !== 0 && upTowardEye[plane] === (side === 1);
    const edgeEnd = mesh.undetermined.edgeStart + mesh.undetermined.edgeCount;
    for (let edge = mesh.translucent.edgeStart; edge < edgeEnd; edge += 1) {
      const slot = slotOfVertex(slots, topology.edgeIndices[edge * 2]!);
      if (slot < 0) continue;
      const rank = ranks[slot]!;
      if (determined(model, slots.cell[slot]!)) {
        if (rank > 0 && !include.buriedLayers) continue;
        const partner = mesh.hinges.partnerPlane[edge]!;
        if (partner >= 0 && !planeShowsSide(partner, mesh.hinges.requiredSide[edge]!)) continue;
      }
      take(edge, rank);
    }
  }

  return {
    topology: {
      faceIndices,
      edgeIndices: Uint32Array.from(edgeIndices),
      edgeAssignments: Uint8Array.from(edgeAssignments),
    },
    faceGroups,
    order,
    edgeOrder: Float64Array.from(edgeOrder),
  };
}

function determined(model: OristudioCpFolded3dRenderModel, cell: number): boolean {
  return (
    (model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 5] ?? 0) !== FOLDED_3D_CELL_UNDETERMINED
  );
}

/**
 * The slot a vertex belongs to, or `-1` for the fallback vertices past the
 * last slot. `vertexStart` is ascending, so a binary search.
 */
function slotOfVertex(slots: Folded3dMesh['slots'], vertex: number): number {
  let low = 0;
  let high = slots.count - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (vertex < slots.vertexStart[mid]!) high = mid - 1;
    else if (vertex >= slots.vertexStart[mid + 1]!) low = mid + 1;
    else return mid;
  }
  return -1;
}

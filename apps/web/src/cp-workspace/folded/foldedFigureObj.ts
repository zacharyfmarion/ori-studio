/**
 * A folded figure as a Wavefront OBJ: its paper in 3D, spread apart as the
 * figure shows it (`implementation-plans/folded-model-obj-export.md`).
 *
 * - **A 3D figure** writes its render model's material source — every sheet
 *   vertex once, where the fold put it — and, with a spatial spread, each
 *   vertex moved by the spread's solve at the figure's amount: the field the
 *   window draws (`posedMaterialPositions`).
 * - **A flat figure** writes the kernel's paper scene, flat, or lifted by the
 *   Default spread the export dialog sets — opening on the figure's own — as
 *   Perspective 3D lifts it, which the dialog previews: the true-size shift in
 *   the plane, and each vertex's height above the shown side's reference
 *   plane, which is what that shift keeps the paper its size against. A reveal
 *   is the shear a flat picture draws a lift with, not geometry, and is left
 *   out. Affine and Depth move only a picture and have no 3D form. A figure
 *   reopened from its file is folded again to give its paper scene
 *   (`foldedFigureObjScene.ts`).
 *
 * Every triangle is wound so its right-hand normal leaves the paper's front,
 * the side drawn in the front colour. A 3D triangle is wound from its ring's
 * winding on the sheet, which the kernel winds about the face's front
 * (`interchange.rs::face_orders`); a flat one on the flat geometry, from its
 * face's `front_up`, before a lift can turn its projection over.
 *
 * Nothing is mirrored: the file is the paper as the window and the canvas draw
 * it, x across the pattern, y up toward its front's viewer, z down the pattern.
 * A 3D figure comes out of the kernel's world, which is the mirror image of
 * that paper (`fromKernelWorld`); a flat one out of the canvas's view space —
 * screen x, depth toward the viewer, screen y — which is right-handed, and
 * which turns a rear pass the canvas draws mirrored back into the paper it is.
 * Either way the unfolded sheet's longer side is 1, the mesh is centred on its
 * bounds, and the texture coordinates are the unfolded sheet's, as the
 * simulator's OBJ has them (`sheetUvs`).
 *
 * Creases, aux lines and colours are not written, as the simulator's are not.
 */
import { shiftedXY, type Point as Pair, type Point3, type SpreadSolution, type Triangle } from '@oristudio/layer-spread';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { prepareConnected } from '../../layer-spread/prepareConnected';
import { perspectiveSpread } from '../../layer-spread/presentation';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import { foldedObj } from '../../lib/foldedExport';
import { sheetUvs } from '../../lib/sheetUvs';
import type { PaperObjExport, PaperObjSpread } from '../../paperExport/paperExportTarget';
import { connectedSpreadSource, scenePoint, type ConnectedSpreadSource } from './connectedSpreadSource';
import { posedMaterialPositions } from './folded3dMaterial';
import { toSimBasis } from './folded3dMesh';
import { ensureSpatialSolution, spatialAmount, spatialSource } from './folded3dSpread';
import type { LayerSpreadOptions } from './foldedLayerSpread';
import { DEFAULT_CONNECTED_SPREAD } from './layerSpreadSettings';
import { triangulateSpreadFace } from './triangulateSpreadFace';

/** A render model's material source: the sheet's vertices, where the fold put them, and its faces. */
export type Folded3dMaterialSource = NonNullable<OristudioCpFolded3dRenderModel['material']>;

/** A folded figure's paper, ready to write. */
export interface FoldedFigureObjMesh {
  /** xyz per vertex, the unfolded sheet's longer side 1, centred on the mesh's bounds. */
  positions: Float32Array;
  /** Three vertices per triangle, wound about the paper's front. */
  triangles: Uint32Array;
  /** uv per vertex, from the unfolded sheet; null when the scene does not place every vertex on it. */
  uvs: Float32Array | null;
}

/** A Default spread's solve and how far the figure lifts by it. */
export interface FoldedFlatObjLift {
  solution: SpreadSolution;
  amount: number;
}

/** Twice a ring's signed area: its winding, in whatever 2D frame `xy` is. */
function ringArea2(ring: readonly number[], xy: readonly Pair[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = xy[ring[i]!]!,
      q = xy[ring[(i + 1) % ring.length]!]!;
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area;
}

/** The triangle wound with the sign of `winding`; one with no area, or no wanted winding, as it came. */
function wound(triangle: Triangle, xy: readonly Pair[], winding: number): Triangle {
  const area = ringArea2(triangle, xy);
  return area * winding < 0 ? [triangle[0], triangle[2], triangle[1]] : triangle;
}

/** Positions as the file writes them: the sheet's longer side 1, centred on their bounds. */
function placed(points: readonly Point3[], span: number): Float32Array {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, p[axis]!);
      max[axis] = Math.max(max[axis]!, p[axis]!);
    }
  const center = min.map((low, axis) => (low + max[axis]!) / 2);
  const scale = 1 / Math.max(span, Number.MIN_VALUE);
  return Float32Array.from(points.flatMap((p) => p.map((v, axis) => (v - center[axis]!) * scale)));
}

/** The sheet's texture coordinates, by the simulator's convention: its lift is `[x, 0, -y]`. */
function sheetTexture(sheet: readonly Pair[]): Float32Array {
  const lifted = sheetUvs(Float32Array.from(sheet.flatMap(([x, y]) => [x, 0, -y])));
  if (!lifted.uvs) throw new Error('The unfolded sheet has no area to map texture coordinates over');
  return lifted.uvs;
}

/**
 * A point of the kernel's 3D world on the file's axes: x along the pattern,
 * up out of the pattern's front, z down the pattern as the editor shows it.
 *
 * The kernel reads the pattern's y-down coordinates as a right-handed frame
 * whose z faces the front's viewer, so its world is the mirror image of the
 * paper the editor and the window show; the window undoes that with the
 * renderer's reflection (`folded3dMesh.ts`, "Winding"). This is the same
 * reflection — the renderer's basis (`toSimBasis`) with its z turned round —
 * so the file is the paper the window draws, and a flat figure folded from
 * the same pattern lies the same way (`foldedFlatObjMesh`).
 */
function fromKernelWorld(p: Point3): Point3 {
  const [x, up, down] = toSimBasis(p);
  return [x, up, -down];
}

/**
 * A 3D figure's material, each vertex where `positions` puts it — where the
 * fold did, or a spread — in the model's coordinates. `span` is the unfolded
 * sheet's longer side in them (`OristudioCpFolded3dRenderModel.span`).
 */
export function folded3dObjMesh(
  material: Folded3dMaterialSource,
  positions: readonly Point3[],
  span: number
): FoldedFigureObjMesh {
  if (positions.length !== material.sheet.length) throw new Error('The folded positions do not match the sheet');
  // The sheet as the spread's own triangulation reads it, so the triangles are its triangles.
  const sheetScale = Math.max(span, 1e-12);
  const sheet = material.sheet.map(([x, y]) => [x / sheetScale, y / sheetScale] as Pair);
  const triangles: number[] = [];
  for (const ring of material.faces) {
    // Against the ring: the reflection out of the kernel's world turns every winding over.
    const winding = -ringArea2(ring, sheet);
    for (const triangle of triangulateSpreadFace(ring, sheet)) triangles.push(...wound(triangle, sheet, winding));
  }
  return {
    positions: placed(positions.map(fromKernelWorld), span),
    triangles: Uint32Array.from(triangles),
    uvs: sheetTexture(material.sheet),
  };
}

/**
 * A flat figure's paper scene as `source` reads it (`connectedSpreadSource`),
 * lifted by a Default spread's solve, or flat with none.
 */
export function foldedFlatObjMesh(
  kernel: OristudioCpFoldedPaperScene,
  source: ConnectedSpreadSource,
  lift: FoldedFlatObjLift | null
): FoldedFigureObjMesh {
  const { input, back, frame, vertices } = source;
  // Kernel units per unit of the solve's frame, which its heights are in.
  const unit = Math.hypot(frame.ex[0], frame.ex[1]);
  // Toward the viewer of the pass the canvas shows: the front's heights point at the front's.
  const toward = back ? -1 : 1;
  const xy = lift ? shiftedXY(input, lift.solution, lift.amount, back) : input.xy;
  const [a, b, c] = lift ? lift.solution.references[back ? 1 : 0].plane : [0, 0, 0];
  const points = input.xy.map(([x, y], v): Point3 => {
    const at = scenePoint(source, xy[v]!);
    // Measured where the vertex lay flat, as the shift that keeps the paper its size is.
    const height = lift ? lift.amount * (lift.solution.heights[v]! - a * x - b * y - c) : 0;
    return [at.x, toward * height * unit, at.y];
  });
  const triangles: number[] = [];
  input.triangles.forEach((triangle, t) => {
    const face = input.triangleFaces[t]!;
    // The solve's frame is right-handed with the front's viewer at +z: a face
    // whose front faces that way winds counter-clockwise in it.
    const front = kernel.faces[face]?.front_up !== back ? 1 : -1;
    triangles.push(...wound(triangle, input.xy, front));
  });
  const sheet = vertices.map((vertex) => kernel.sheet_points[vertex]);
  return {
    positions: placed(points, kernel.sheet),
    triangles: Uint32Array.from(triangles),
    uvs: sheet.every((point) => point !== undefined) ? sheetTexture(sheet.map((point) => [point.x, point.y])) : null,
  };
}

/** The file: the simulator's serializer, at the whole fold. */
export function foldedFigureObj(mesh: FoldedFigureObjMesh): string {
  return foldedObj({ positions: mesh.positions, triangles: mesh.triangles, foldPercent: 100 }, 'folded', mesh.uvs ?? undefined);
}

/**
 * A 3D figure's OBJ for the export dialog, its spread solved when it is asked
 * for: none for a model that carries no material source.
 */
export function folded3dFigureObjExport(
  figure: Pick<OristudioCpFoldedFigureEntry, 'spread' | 'displayStyle' | 'folded3d'>,
  model: OristudioCpFolded3dRenderModel,
  signal: AbortSignal
): PaperObjExport | undefined {
  const { material } = model;
  if (!material) return undefined;
  const amount = spatialAmount(figure) ?? 0;
  return {
    unavailableReason: null,
    build: async () => {
      let positions: readonly Point3[] = material.positions;
      if (amount > 0) {
        // As its picture is: a spread is drawn only on a determined, closed fold.
        if (figure.folded3d?.verdict.verdict !== 'folded') throw new Error('Spatial spread requires a determined, closed fold');
        positions = posedMaterialPositions(spatialSource(model), await ensureSpatialSolution(model, signal), amount);
      }
      return foldedFigureObj(folded3dObjMesh(material, positions, model.span));
    },
  };
}

/**
 * The spread a flat figure's OBJ opens on: its own Default spread, else none,
 * at Default's starting amount, from which the dialog's Amount moves. An
 * Affine or Depth spread moves the picture alone and has no 3D form.
 */
export function foldedFigureObjSpread(spread: LayerSpreadOptions | null): PaperObjSpread {
  return spread?.kind === 'connected'
    ? { on: spread.amount > 0, amount: spread.amount }
    : { on: false, amount: DEFAULT_CONNECTED_SPREAD.amount };
}

/**
 * A flat figure's OBJ for the export dialog, from the paper scene `scene`
 * gives — the one its picture is drawn from, or one read or folded again on
 * the first ask (`foldedFigureObjScene`) — written flat, or lifted by the
 * Default spread the dialog sets as Perspective 3D lifts it
 * (`perspectiveSpread`): what the dialog's preview draws is the file.
 * `initial` is the figure's own spread. The scene and its solve are asked
 * for once and held until `signal` aborts, as the dialog closes.
 */
export function foldedFlatFigureObjExport(
  scene: () => Promise<OristudioCpFoldedPaperScene>,
  initial: PaperObjSpread,
  signal: AbortSignal
): PaperObjExport {
  let read: Promise<OristudioCpFoldedPaperScene> | null = null;
  let solved: Promise<ConnectedSpreadView> | null = null;
  const sceneOnce = () => (read ??= scene());
  const prepare = () =>
    (solved ??= sceneOnce().then((kernel) => {
      if (signal.aborted) throw new DOMException('The export dialog closed', 'AbortError');
      const lease = prepareConnected(kernel);
      signal.addEventListener('abort', () => lease.release(), { once: true });
      return lease.promise.then((prepared) => ({ scene: kernel, prepared }));
    }));
  return {
    unavailableReason: null,
    spread: { initial, prepare, scene: sceneOnce },
    build: async (spread = initial) => {
      const kernel = await sceneOnce();
      if (!spread.on || spread.amount <= 0) {
        return foldedFigureObj(foldedFlatObjMesh(kernel, connectedSpreadSource(kernel), null));
      }
      const { prepared } = await prepare();
      const { amount } = perspectiveSpread({ amount: spread.amount, reveal: [0, 0] });
      return foldedFigureObj(foldedFlatObjMesh(kernel, prepared.source, { solution: prepared.solution, amount }));
    },
  };
}

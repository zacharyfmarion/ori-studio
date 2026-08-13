import {
  GlCore,
  MeshRenderer,
  cameraUniforms,
  type RenderSettings,
} from '@treemaker/origami-simulator';
import { folded3dMesh, packFolded3dPositionTexture } from '../../cp-workspace/folded/folded3dMesh';
import { UNDETERMINED_FACE_ALPHA } from '../../cp-workspace/folded/folded3dStyle';
import { folded3dDrawPasses } from '../../simulator/foldedMeshSource';
import type { StartFigureAsset } from './startFigureAsset';

/**
 * The start figure as a WebGL2 mesh on a plain canvas.
 *
 * This is `FoldedMeshSource` (apps/web/src/simulator/foldedMeshSource.ts) with
 * one thing changed: it draws to a visible `HTMLCanvasElement` on the main
 * thread instead of an `OffscreenCanvas` in the worker. The geometry comes from
 * `folded3dMesh` — the same triangulation, the same layer displacement, the same
 * crease assignments an in-app folded figure gets — and it is drawn by the same
 * `MeshRenderer` through the same `cameraUniforms` and `RenderSettings`. None of
 * that is written twice, which is what makes the start screen's figure and the
 * editor's the same picture rather than two that resemble each other.
 *
 * `MeshRenderer` reads every vertex from a position *texture* via `texelFetch`.
 * A frozen figure writes that texture once at load and never again, which is
 * what makes a frame a uniform change and a draw or two rather than a solve.
 *
 * Deliberately module-scoped and dynamically imported by `StartFigure`: nothing
 * else on the welcome route needs `MeshRenderer`, and a static import would put
 * the shaders in the entry chunk for a decoration.
 */
export class StartFigureMesh {
  private disposed = false;

  private constructor(
    private readonly core: GlCore,
    private readonly mesh: MeshRenderer,
    private readonly canvas: HTMLCanvasElement,
    private readonly radius: number,
    private readonly faceIndexCount: number,
    private readonly undeterminedIndexStart: number,
    private readonly undeterminedFaceAlpha: number
  ) {}

  /**
   * Build a mesh, or `null` when this machine cannot draw one.
   *
   * `GlCore.create` returns null without WebGL2 and *throws* without
   * `EXT_color_buffer_float`; `folded3dMesh` refuses a model past its vertex
   * budget. Every arm returns null: a start screen must never take the page down
   * over a decoration.
   */
  static create(canvas: HTMLCanvasElement, asset: StartFigureAsset): StartFigureMesh | null {
    const built = folded3dMesh(asset.model);
    if (built.kind !== 'mesh') return null;
    const { topology, radius } = built.mesh;
    const positions = orient(built.mesh.positions, asset.view.orient);

    let core: GlCore | null = null;
    try {
      core = GlCore.create(canvas);
      if (!core) return null;
      const textureDim = topology.textureDim;
      // `u_originalPosition` holds rest positions and `u_lastPosition` a
      // displacement the shader adds to them; a static figure puts its geometry
      // in the first and zeros in the second. `u_lastVelocity` carries per-node
      // strain, which a frozen figure has none of — but `bindCommon` binds all
      // three unconditionally and `getTexture` throws on a name it does not
      // know, so a missing one is a hard failure at the first draw rather than a
      // silently absent feature. `data: null` is zero-filled by the WebGL spec.
      core.createTexture('u_originalPosition', {
        width: textureDim,
        height: textureDim,
        data: packFolded3dPositionTexture(positions, textureDim),
      });
      core.createTexture('u_lastPosition', {
        width: textureDim,
        height: textureDim,
        data: null,
      });
      core.createTexture('u_lastVelocity', {
        width: textureDim,
        height: textureDim,
        data: null,
      });
      const mesh = new MeshRenderer(core, topology);
      return new StartFigureMesh(
        core,
        mesh,
        canvas,
        radius,
        topology.faceIndices.length,
        built.mesh.undeterminedIndexStart,
        UNDETERMINED_FACE_ALPHA
      );
    } catch {
      core?.dispose();
      return null;
    }
  }

  /** True once the context has gone away; the caller falls back to the image. */
  get lost(): boolean {
    return this.disposed || this.core.gl.isContextLost();
  }

  /**
   * Match the drawing buffer to the element's CSS size.
   *
   * Returns whether anything changed, so the caller can skip a redraw. Called
   * from a `ResizeObserver` rather than per frame: reading a rect forces layout,
   * and a 60fps loop paying for a full flush to learn something that only
   * changes on resize is the cost `canvas2dFrame` documents.
   */
  resize(cssWidth: number, cssHeight: number, dpr: number): boolean {
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  /**
   * Draw one frame.
   *
   * Orthographic, by the same argument `foldedMeshSource` makes: the frame is
   * sized from the model's bounding *sphere*, which images to a circle of the
   * same radius at every orientation only without perspective. Under the mesh
   * renderer's default one-point perspective a near point grows by up to 45%, so
   * a turning figure would swell out of its own frame at some angles.
   */
  render(view: { yaw: number; pitch: number }, settings: RenderSettings): void {
    if (this.lost) return;
    const { width, height } = this.canvas;
    const camera = cameraUniforms(
      { ...view, zoom: 1 },
      [0, 0, 0],
      this.radius,
      width,
      height
    );
    const orthographic = {
      ...camera,
      camDist: camera.depthRange * ORTHOGRAPHIC_EYE_DISTANCE,
    };
    // One pass normally; two when the kernel could not decide some cell's layer
    // order, so those cells draw translucent over the resolved stack. Shared with
    // the worker's folded figures rather than re-decided here — drawing an
    // undetermined stack opaque is drawing an order, and the wrong one.
    for (const pass of folded3dDrawPasses(
      {
        faceIndexCount: this.faceIndexCount,
        undeterminedIndexStart: this.undeterminedIndexStart,
        undeterminedFaceAlpha: this.undeterminedFaceAlpha,
      },
      settings
    )) {
      this.mesh.render(
        orthographic,
        { ...settings, showEdges: pass.showEdges, faceAlpha: pass.faceAlpha },
        null,
        { clear: pass.clear, faceRange: pass.faceRange ?? undefined }
      );
    }
  }

  /** Fires once if the context is lost, so the caller can drop to the image. */
  onContextLost(handler: () => void): void {
    this.canvas.addEventListener('webglcontextlost', handler, { once: true });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.dispose();
    this.core.dispose();
  }
}

/**
 * Stand the model up, once, in model space.
 *
 * `folded3dMesh` hands back a figure in the *paper's* frame: `toSimBasis` puts
 * the paper normal on the renderer's vertical, which is right for a folded
 * figure in the editor, where the reader is looking down at a stack. A hero
 * figure wants the opposite — the design's own line of symmetry vertical, so it
 * stands up and so the orbit's yaw turns it like a turntable rather than
 * tumbling it about an axis that means nothing to the shape.
 *
 * Applied to the finished mesh rather than to the render model, and after the
 * layer displacement rather than before, because a rigid rotation of the whole
 * figure cannot disturb an ordering that is already baked into the positions.
 * Rotating the kernel's `ring_points` instead would have meant rotating
 * `face_normals` and `plane_frames` in step, with three chances to disagree.
 *
 * Intrinsic Z-Y-X, which is only a convention; the angles come from the
 * generator and are chosen by eye against the real render.
 */
function orient(
  positions: Float32Array,
  angles: readonly [number, number, number] | undefined
): Float32Array {
  if (!angles || angles.every((angle) => angle === 0)) return positions;
  const [rx, ry, rz] = angles;
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)];
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)];
  const [cz, sz] = [Math.cos(rz), Math.sin(rz)];
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x0 = positions[i]!;
    const y0 = positions[i + 1]!;
    const z0 = positions[i + 2]!;
    // Rx
    const y1 = cx * y0 - sx * z0;
    const z1 = sx * y0 + cx * z0;
    // Ry
    const x2 = cy * x0 + sy * z1;
    const z2 = -sy * x0 + cy * z1;
    // Rz
    out[i] = cz * x2 - sz * y1;
    out[i + 1] = sz * x2 + cz * y1;
    out[i + 2] = z2;
  }
  return out;
}

/**
 * Eye distance as a multiple of `depthRange`, far enough that the shader's
 * `camDist / (camDist - depth)` collapses to 1. Same value and same reason as
 * `foldedMeshSource.ts`.
 */
const ORTHOGRAPHIC_EYE_DISTANCE = 5_000;

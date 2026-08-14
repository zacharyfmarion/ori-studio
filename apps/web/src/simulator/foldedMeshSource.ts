import {
  GlCore,
  MeshRenderer,
  type CameraUniforms,
  type RenderSettings,
} from '@treemaker/origami-simulator';

/**
 * A 3D folded figure as something the worker can draw, with no solver behind it.
 *
 * `MeshRenderer` reads every vertex from a position *texture* the solver
 * normally rewrites each step. A folded figure's geometry never moves, so the
 * texture is written once at load and never again: after that a frame is a
 * uniform change and a draw. That is the whole reason a document can hold tens
 * of live 3D figures where it can only hold one running simulation — a figure
 * costs a *mesh*, not a session.
 *
 * Shares the worker's one WebGL2 context, exactly as the solver sessions do:
 * `getContext('webgl2')` on an already-contexted canvas returns the context that
 * is already there, so every `GlCore` over `renderCanvas` wraps the same one.
 * Browsers cap contexts at four per worker, and that cap is why bitmap
 * presentation exists at all.
 */

/** Everything the worker needs to draw one folded figure, in transferable form. */
export interface Folded3dMeshPayload {
  /** RGBA position texture, `textureDim² × 4` floats. */
  positions: ArrayBuffer;
  textureDim: number;
  vertexCount: number;
  /** Triangle vertex indices, `Uint32`. */
  faceIndices: ArrayBuffer;
  /** Crease endpoint indices, `Uint32`, 2 per crease. */
  edgeIndices: ArrayBuffer;
  /** One assignment code per crease, `Uint8`. */
  edgeAssignments: ArrayBuffer;
  /** Camera fit — the mesh is already centroid-relative, so this is the origin. */
  center: [number, number, number];
  radius: number;
  /**
   * Where the cells whose layer order the kernel could not resolve begin, in
   * `faceIndices`. They are emitted last precisely so they can be drawn
   * separately; see {@link FoldedMeshSource.render}.
   */
  undeterminedIndexStart: number;
  /** The same cut through the creases, counted in **edges**. */
  undeterminedEdgeStart: number;
  /** Face opacity for that second pass. */
  undeterminedFaceAlpha: number;
}

export class FoldedMeshSource {
  private constructor(
    private readonly core: GlCore,
    private readonly mesh: MeshRenderer,
    private readonly faceIndexCount: number,
    private readonly undeterminedIndexStart: number,
    private readonly edgeCount: number,
    private readonly undeterminedEdgeStart: number,
    private readonly undeterminedFaceAlpha: number,
    /**
     * Depth bits of the *default* framebuffer, which is what the layer
     * displacement is budgeted against — see `folded3dMesh.ts`. 24 everywhere we
     * have looked, but 16 is legal WebGL2 and at 16 a deep stack collides.
     */
    readonly depthBits: number
  ) {}

  static create(
    canvas: OffscreenCanvas,
    payload: Folded3dMeshPayload
  ): FoldedMeshSource | null {
    const core = GlCore.create(canvas);
    if (!core) return null;
    const dim = payload.textureDim;
    try {
      // `u_originalPosition` holds absolute rest positions and `u_lastPosition`
      // a displacement from them — the shader adds the two — so a static figure
      // puts its geometry in the first and zeros in the second. `u_lastVelocity`
      // carries per-node strain, which a folded figure has none of, but
      // `bindCommon` binds all three unconditionally and `getTexture` throws on a
      // name it does not know: a missing one is a hard failure at the first draw,
      // not a silently absent feature.
      //
      // `data: null` is zero-filled by the WebGL spec (unlike OpenGL ES), so the
      // two companions cost GPU memory and no JS allocation.
      core.createTexture('u_originalPosition', {
        width: dim,
        height: dim,
        data: new Float32Array(payload.positions),
      });
      core.createTexture('u_lastPosition', { width: dim, height: dim, data: null });
      core.createTexture('u_lastVelocity', { width: dim, height: dim, data: null });
      const mesh = new MeshRenderer(core, {
        faceIndices: new Uint32Array(payload.faceIndices),
        edgeIndices: new Uint32Array(payload.edgeIndices),
        edgeAssignments: new Uint8Array(payload.edgeAssignments),
        textureDim: dim,
      });
      return new FoldedMeshSource(
        core,
        mesh,
        payload.faceIndices.byteLength / 4,
        payload.undeterminedIndexStart,
        payload.edgeAssignments.byteLength,
        payload.undeterminedEdgeStart,
        payload.undeterminedFaceAlpha,
        readDepthBits(core)
      );
    } catch {
      core.dispose();
      return null;
    }
  }

  /**
   * What GL actually gave us, which is not always what the canvas was set to —
   * a browser silently clamps a drawing buffer it cannot back (5760 for a canvas
   * set to 16384, no error, `isContextLost()` false). Reading it rather than
   * `canvas.width` is what keeps a render and its crop inside one rectangle;
   * past the clamp the crop reads nothing and the window goes transparent.
   * Identical to `WebglSolver.drawingBufferSize`, which is the point — the crop
   * path below it cannot tell the two kinds apart.
   */
  get drawingBufferSize(): { width: number; height: number } {
    return {
      width: this.core.gl.drawingBufferWidth,
      height: this.core.gl.drawingBufferHeight,
    };
  }

  /** Draw the figure — see {@link folded3dDrawPasses} for the one-or-two decision. */
  render(
    camera: CameraUniforms,
    settings: RenderSettings,
    target: WebGLFramebuffer | null = null
  ): void {
    const orthographic = withoutPerspective(camera);
    const passes = folded3dDrawPasses(
      {
        faceIndexCount: this.faceIndexCount,
        undeterminedIndexStart: this.undeterminedIndexStart,
        edgeCount: this.edgeCount,
        undeterminedEdgeStart: this.undeterminedEdgeStart,
        undeterminedFaceAlpha: this.undeterminedFaceAlpha,
      },
      settings
    );
    for (const pass of passes) {
      this.mesh.render(
        orthographic,
        { ...settings, showEdges: pass.showEdges, faceAlpha: pass.faceAlpha },
        target,
        {
          clear: pass.clear,
          faceRange: pass.faceRange ?? undefined,
          edgeRange: pass.edgeRange ?? undefined,
        }
      );
    }
  }

  dispose(): void {
    this.mesh.dispose();
    this.core.dispose();
  }
}

/**
 * Eye distance as a multiple of `depthRange`, far enough that the shader's
 * `camDist / (camDist − depth)` collapses to 1.
 *
 * `depthRange` is twice the model radius and the model spans ±one radius of
 * view depth, so at this distance the widest point grows by 1 part in 10,000 —
 * invisible, and orthographic for every purpose that matters.
 */
const ORTHOGRAPHIC_EYE_DISTANCE = 5_000;

/**
 * Drop the mesh renderer's one-point perspective for a folded figure.
 *
 * A simulation is a viewport, where converging parallels read as depth. A folded
 * figure is a **window** onto a model, and its window is sized from the model's
 * bounding *sphere* — which images to a circle of the same radius at every
 * orientation *only under an orthographic projection*. Under perspective a point
 * near the eye grows by up to 45%, so the model would escape its own frame at
 * some angles and the frame would have to grow, which is the resizing chrome
 * `frameRadius` exists to stop. It also keeps the 3D figure projecting the way
 * the flat figure beside it does.
 *
 * Applied here rather than in `cameraUniforms`, so the simulation path — which
 * wants the perspective — is untouched.
 */
function withoutPerspective(camera: CameraUniforms): CameraUniforms {
  return { ...camera, camDist: camera.depthRange * ORTHOGRAPHIC_EYE_DISTANCE };
}

/** One `MeshRenderer.render` call of a folded figure's frame. */
export interface Folded3dDrawPass {
  /** Clear colour and depth first. True on the first pass only. */
  clear: boolean;
  showEdges: boolean;
  faceAlpha: number;
  /** A run of `faceIndices`, or null for all of them. */
  faceRange: { start: number; count: number } | null;
  /** A run of the creases, in **edges**, or null for all of them. */
  edgeRange: { start: number; count: number } | null;
}

/**
 * How a folded figure's frame breaks into draws — one pass, or two.
 *
 * **Two** when some cells are undetermined and the rest are opaque: the resolved
 * stack draws first, then the unresolved cells over it at a lower opacity,
 * without clearing. Those cells carry no displacement — the kernel has no order
 * for them and inventing one would present a guess as fact — so their slots are
 * exactly coincident. Translucency is the honest way to draw a stack whose order
 * is unknown; drawing it opaque would be drawing an order, and the wrong one.
 *
 * That case is rare per model and total when it happens. Across the non-flat
 * corpus exactly one model has any undetermined cells, and it has 33 of 37.
 *
 * **One** otherwise: a fully-determined figure has nothing to separate, a
 * wireframe style draws no faces at all, and a translucent style has already
 * made every cell see-through, which leaves the distinction nothing to say.
 *
 * Split out from {@link FoldedMeshSource.render} because it is the whole of the
 * decision and it is testable without a GL context, which the draw itself is not.
 */
export function folded3dDrawPasses(
  mesh: {
    faceIndexCount: number;
    undeterminedIndexStart: number;
    edgeCount: number;
    undeterminedEdgeStart: number;
    undeterminedFaceAlpha: number;
  },
  settings: Pick<RenderSettings, 'showFaces' | 'showEdges' | 'faceAlpha'>
): Folded3dDrawPass[] {
  const start = mesh.undeterminedIndexStart;
  const undeterminedCount = mesh.faceIndexCount - start;
  const single: Folded3dDrawPass = {
    clear: true,
    showEdges: settings.showEdges,
    faceAlpha: settings.faceAlpha,
    faceRange: null,
    edgeRange: null,
  };
  if (undeterminedCount <= 0 || !settings.showFaces || settings.faceAlpha < 1) {
    return [single];
  }
  const edgeStart = mesh.undeterminedEdgeStart;
  return [
    {
      ...single,
      faceRange: { start: 0, count: start },
      edgeRange: { start: 0, count: edgeStart },
    },
    {
      clear: false,
      // Each pass brings its own creases now that a crease belongs to a layer:
      // an undetermined cell's linework is drawn here, with its own paper and at
      // its opacity. Splitting the range is what keeps the ink single — the two
      // runs partition the creases, so nothing is drawn twice.
      showEdges: settings.showEdges,
      faceAlpha: mesh.undeterminedFaceAlpha,
      faceRange: { start, count: undeterminedCount },
      edgeRange: { start: edgeStart, count: mesh.edgeCount - edgeStart },
    },
  ];
}

/**
 * Depth bits of the default framebuffer.
 *
 * `DEPTH_BITS` reports the *bound* framebuffer, and this context spends most of
 * its life bound to one of the solver's depthless render targets — where the
 * honest answer is 0. Binding null first is the difference between reading the
 * number and reading "no depth buffer".
 */
function readDepthBits(core: GlCore): number {
  const gl = core.gl;
  const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const bits = Number(gl.getParameter(gl.DEPTH_BITS) ?? 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
  return Number.isFinite(bits) ? bits : 0;
}

/**
 * Depth bits the layer displacement was budgeted for.
 *
 * At 24 the deepest model in the non-flat corpus (`plant_penguin.osf`, 14
 * layers) separates its layers by 258 depth units. At 16 that becomes 1.01 —
 * i.e. the deepest real model sits exactly on the resolution floor and its
 * layers start to collide. A 16-bit default framebuffer is legal WebGL2, so this
 * is reported rather than assumed.
 */
export const FOLDED_3D_REQUIRED_DEPTH_BITS = 24;

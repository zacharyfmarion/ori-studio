import {
  GlCore,
  MeshRenderer,
  viewDepthAxis,
  type CameraUniforms,
  type RenderSettings,
} from '@treemaker/origami-simulator';
import type {
  Folded3dHingeGroup,
  Folded3dRange,
  Folded3dSkin,
} from '../cp-workspace/folded/folded3dMesh';

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
   * The two visible surfaces of each plane, and the ranges that draw them — see
   * `Folded3dSkin`. An opaque figure draws one per plane, chosen by `up · eye`.
   */
  skins: Folded3dSkin[];
  /** Every determined layer once, for a translucent style. */
  translucent: Folded3dRange;
  /** Cells with no resolved order, drawn translucent over the rest. */
  undetermined: Folded3dRange;
  /** Face opacity for that second pass. */
  undeterminedFaceAlpha: number;
}

export class FoldedMeshSource {
  private constructor(
    private readonly core: GlCore,
    private readonly mesh: MeshRenderer,
    private readonly skins: readonly Folded3dSkin[],
    private readonly translucent: Folded3dRange,
    private readonly undetermined: Folded3dRange,
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
        payload.skins,
        payload.translucent,
        payload.undetermined,
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
        skins: this.skins,
        translucent: this.translucent,
        undetermined: this.undetermined,
        undeterminedFaceAlpha: this.undeterminedFaceAlpha,
      },
      settings,
      camera
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
 * Which side of a plane the eye is on.
 *
 * `up` against the view's depth axis — positive means the plane's `up` points
 * toward the viewer, so the eye sees the `+1` skin. Read off the view rotation
 * rather than by transforming a point, because this is a direction: it has no
 * centre and no translation.
 *
 * A single sign for the whole plane, and that is exact rather than approximate:
 * a folded figure is drawn orthographically ({@link withoutPerspective}), so
 * every ray shares one direction.
 */
function skinFacesEye(skin: Folded3dSkin, camera: CameraUniforms): boolean {
  const [ax, ay, az] = viewDepthAxis(camera.rotation);
  const depth = skin.up[0] * ax + skin.up[1] * ay + skin.up[2] * az;
  return skin.side === 1 ? depth >= 0 : depth < 0;
}

/**
 * How a folded figure's frame breaks into draws.
 *
 * **Opaque**: one pass per plane, drawing the skin that faces the eye — the top
 * face of each of that plane's cells, or the bottom, plus that layer's creases.
 * Inside a skin nothing is coplanar with anything else, so the depth buffer is
 * only ever deciding plane against plane. Cells the solver could not order have
 * no top and no bottom, so they follow in a translucent pass: saying "these
 * layers could be either way round" by seeing through them, rather than by
 * picking one order and drawing it confidently.
 *
 * **Translucent**: a single pass over every layer. The skins would hide most of
 * the stack, which is the opposite of what an X-ray style is for, and coplanar
 * layers are harmless here because translucent faces do not write depth — they
 * blend in draw order rather than competing for it.
 *
 * Consecutive planes that chose the same side are merged into one draw, so a
 * figure whose planes agree costs one pass rather than one per plane.
 *
 * Split out from {@link FoldedMeshSource.render} because it is the whole of the
 * decision and it is testable without a GL context, which the draw itself is not.
 */
export function folded3dDrawPasses(
  mesh: {
    skins: readonly Folded3dSkin[];
    translucent: Folded3dRange;
    undetermined: Folded3dRange;
    undeterminedFaceAlpha: number;
  },
  settings: Pick<RenderSettings, 'showFaces' | 'showEdges' | 'faceAlpha'>,
  camera: CameraUniforms
): Folded3dDrawPass[] {
  const passes: Folded3dDrawPass[] = [];
  const axis = viewDepthAxis(camera.rotation);
  const push = (range: Folded3dRange, faceAlpha: number): void => {
    if (range.faceIndexCount === 0 && range.edgeCount === 0) return;
    passes.push({
      clear: passes.length === 0,
      showEdges: settings.showEdges,
      faceAlpha,
      faceRange: { start: range.faceIndexStart, count: range.faceIndexCount },
      edgeRange: { start: range.edgeStart, count: range.edgeCount },
    });
  };

  // A translucent style shows the whole stack, so the skins say nothing it
  // wants. A wireframe draws no paper, so there is no occlusion to arrange
  // either — but it still wants one line per crease rather than one per layer,
  // which is what the skins give it.
  if (settings.showFaces && settings.faceAlpha < 1) {
    push(mesh.translucent, settings.faceAlpha);
    push(mesh.undetermined, settings.faceAlpha);
  } else {
    // Far-to-near. View depth grows toward the eye, so ascending order draws the
    // farthest plane first — and a nearer plane's paper then lands *after* a
    // farther plane's creases and covers them.
    //
    // This is what settles the fold line, and it settles it discretely. A fold
    // line lies in **both** planes it joins, so the two are at exactly the same
    // depth there by construction; every attempt to separate them with an
    // epsilon — a bias, then an inset — worked at most cameras and failed on the
    // set of directions where that epsilon's depth contribution vanished. Draw
    // order has no such set.
    const visible = mesh.skins
      .filter((skin) => skinFacesEye(skin, camera))
      .map((skin) => ({
        skin,
        depth:
          skin.centroid[0] * axis[0] + skin.centroid[1] * axis[1] + skin.centroid[2] * axis[2],
      }))
      .sort((l, r) => l.depth - r.depth)
      .map((entry) => entry.skin);

    // Which side of each plane the eye is on — the fact a hinge needs and a
    // single skin cannot know, because the far side of a bend belongs to a
    // different plane whose exposed layer is decided by this same test.
    const sideOfPlane = new Map<number, 1 | -1>();
    for (const skin of visible) sideOfPlane.set(skin.plane, skin.side);
    const hingeShows = (group: Folded3dHingeGroup): boolean =>
      sideOfPlane.get(group.partnerPlane) === group.requiredSide;

    let run: Folded3dRange | null = null;
    // Admitted hinge runs of the skins in the current merge, drawn right after
    // it — the same place in the order the skin's own creases occupy, so a
    // nearer plane's paper still lands on top of them.
    let runHinges: Folded3dHingeGroup[] = [];
    const flush = (): void => {
      if (run) push(run, settings.faceAlpha);
      run = null;
      if (settings.showEdges) {
        for (const group of runHinges) {
          passes.push({
            clear: passes.length === 0,
            showEdges: true,
            faceAlpha: settings.faceAlpha,
            faceRange: { start: 0, count: 0 },
            edgeRange: { start: group.edgeStart, count: group.edgeCount },
          });
        }
      }
      runHinges = [];
    };

    for (const skin of visible) {
      const admitted = skin.hingeGroups.filter(hingeShows);
      const next: Folded3dRange = {
        faceIndexStart: skin.faceIndexStart,
        faceIndexCount: skin.faceIndexCount,
        edgeStart: skin.edgeStart,
        edgeCount: skin.edgeCount,
      };
      // Only when the sort left them adjacent in the buffer, which it usually
      // does not — a merge that reordered the draws would undo the sort.
      if (
        run &&
        run.faceIndexStart + run.faceIndexCount === next.faceIndexStart &&
        run.edgeStart + run.edgeCount === next.edgeStart
      ) {
        run.faceIndexCount += next.faceIndexCount;
        run.edgeCount += next.edgeCount;
        runHinges.push(...admitted);
        continue;
      }
      flush();
      run = next;
      runHinges = [...admitted];
    }
    flush();
    push(mesh.undetermined, mesh.undeterminedFaceAlpha);
  }

  // The fallback creases sit at the head of the crease buffer and belong to no
  // layer, so no skin carries them. One extra draw, and only when there are any
  // — which there never are on a model whose faces all survived the kernel's
  // area bar.
  const fallback = mesh.skins.length > 0 ? mesh.skins[0]!.edgeStart : mesh.translucent.edgeStart;
  if (fallback > 0 && settings.showEdges) {
    passes.push({
      clear: passes.length === 0,
      showEdges: true,
      faceAlpha: settings.faceAlpha,
      faceRange: { start: 0, count: 0 },
      edgeRange: { start: 0, count: fallback },
    });
  }

  if (passes.length === 0) {
    // Nothing to draw, but the frame still has to be cleared or the previous
    // one shows through.
    passes.push({
      clear: true,
      showEdges: false,
      faceAlpha: settings.faceAlpha,
      faceRange: { start: 0, count: 0 },
      edgeRange: { start: 0, count: 0 },
    });
  }
  return passes;
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

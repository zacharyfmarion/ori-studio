/**
 * What the crease-pattern canvas actually needs from the host's graphics stack,
 * and a probe that answers it before regl is asked to build anything.
 *
 * Worth stating precisely, because a wrong belief about it is what the user
 * gets told when it fails. regl 2.x is a **WebGL1** library: it asks for
 * `getContext('webgl')` and never for `webgl2`. The single capability this
 * renderer adds on top is `ANGLE_instanced_arrays` — creases, points, markers
 * and wedges are all instanced draws, so without it nothing on this surface can
 * be drawn at all. Nothing here uses float render targets, multiple render
 * targets, or depth textures, and reference-image textures are uploaded
 * NPOT-safe (linear filtering, clamp wrap, no mipmaps), so none of those are
 * requirements either.
 *
 * The probe exists so the unavailable state can name the missing capability.
 * Left to regl, every failure arrives as one of its own strings — including
 * "try upgrading your system or a different browser", which is not advice you
 * can act on from an iPad.
 */

/**
 * Context attributes for the crease-pattern surface. Shared with the probe so
 * the two cannot ask for different contexts and disagree about the answer.
 */
export const CP_GL_ATTRIBUTES: WebGLContextAttributes = {
  antialias: true,
  alpha: false,
  premultipliedAlpha: true,
  // On-demand renderer: we only redraw on mount/resize/state change, not every
  // frame, so preserve the buffer to survive compositor repaints between
  // renders. (Revisit if we move to continuous per-frame drawing.)
  preserveDrawingBuffer: true,
};

/** The one extension the renderer cannot run without. */
export const CP_REQUIRED_EXTENSION = 'ANGLE_instanced_arrays';

export type CpWebglGap =
  | 'no-context'
  | 'no-instanced-arrays'
  /**
   * A context was granted and was already dead when regl asked it anything.
   *
   * Distinct from `no-context` because the cause and the advice are different:
   * this is a document that has run out of GL contexts, not a stack that cannot
   * provide one. Every `getExtension` on a lost context returns null, so left
   * unnamed this arrives as a missing-extension error and reads as a decade-old
   * GPU — see {@link classifyCpWebglFailure}.
   */
  | 'context-lost-at-start';

export type CpWebglSupport = { supported: true } | { supported: false; gap: CpWebglGap };

/**
 * A technical one-liner for the unavailable state's detail line, in the same
 * register as the raw error message that line otherwise carries.
 */
export function describeCpWebglGap(gap: CpWebglGap): string {
  switch (gap) {
    case 'no-context':
      return 'no WebGL context (getContext("webgl") returned null)';
    case 'context-lost-at-start':
      return 'WebGL context was already lost when the renderer started';
    case 'no-instanced-arrays':
      return `WebGL context without ${CP_REQUIRED_EXTENSION}`;
  }
}

/**
 * regl's own lookup order, all three names of it (`createContext`, regl.js:863).
 * The probe gates the real path, so anything it refuses to try is a context the
 * renderer can no longer get — it must not be the stricter of the two.
 */
const CONTEXT_NAMES = ['webgl', 'experimental-webgl', 'webgl-experimental'] as const;

function acquireProbeContext(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  for (const name of CONTEXT_NAMES) {
    try {
      const gl = canvas.getContext(name, CP_GL_ATTRIBUTES);
      if (gl) return gl as WebGLRenderingContext;
    } catch {
      // Same as regl: a name this browser rejects outright is just a miss.
    }
  }
  return null;
}

/**
 * Ask a throwaway 1×1 canvas the same questions regl would, then hand the
 * context slot straight back — contexts are a capped per-document resource, and
 * this one exists only to be interrogated.
 */
export function probeCpWebglSupport(): CpWebglSupport {
  if (typeof document === 'undefined') return { supported: false, gap: 'no-context' };
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const gl = acquireProbeContext(canvas);
  if (!gl) return { supported: false, gap: 'no-context' };
  try {
    if (!gl.getExtension(CP_REQUIRED_EXTENSION)) {
      return { supported: false, gap: 'no-instanced-arrays' };
    }
    return { supported: true };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * Why the renderer failed on *this* canvas, asked after regl has thrown on it.
 *
 * The probe and regl can disagree, and when they do the user is told the wrong
 * thing. The probe runs on a throwaway 1×1 canvas and hands the context slot
 * straight back; the renderer runs on the real one, moments later, on a document
 * that may by then hold several live contexts. A stack that granted the first
 * can still fail the second — and WebKit fails it by handing back a context that
 * is already lost rather than by returning null. Every `getExtension` on a lost
 * context returns null, so regl raises its missing-extension error and the
 * editor tells someone with a perfectly capable GPU to upgrade their system.
 *
 * Asking the canvas itself is what separates those. `getContext` returns the
 * context regl already created rather than making a second one, so this observes
 * the failure instead of reconstructing it.
 *
 * Returns `null` when the canvas looks healthy — regl throws for reasons that
 * are not capability gaps (a shader that would not compile, for one), and
 * claiming a gap we cannot see would be the same mistake in the other direction.
 * The caller keeps the raw message in that case.
 *
 * Deliberately **not** the probe: nothing here calls `loseContext`, which on the
 * real canvas would destroy the context the caller is about to report on.
 */
export function classifyCpWebglFailure(canvas: HTMLCanvasElement): CpWebglGap | null {
  let gl: WebGLRenderingContext | null;
  try {
    gl = acquireProbeContext(canvas);
  } catch {
    return 'no-context';
  }
  if (!gl) return 'no-context';
  if (gl.isContextLost()) return 'context-lost-at-start';
  try {
    if (!gl.getExtension(CP_REQUIRED_EXTENSION)) return 'no-instanced-arrays';
  } catch {
    return 'no-instanced-arrays';
  }
  return null;
}

let cached: CpWebglSupport | null = null;

/**
 * {@link probeCpWebglSupport}, memoized — but only its *yes*.
 *
 * A yes cannot become a no: the probe costs a context, and a stack that has
 * granted one will grant another. A no can very much become a yes, because
 * `getContext` also returns null when the document is simply out of context
 * slots — and this app puts several GL canvases on screen at once, on a device
 * that reclaims them under memory pressure. Caching that answer would turn one
 * crowded moment into a permanently unsupported editor for the rest of the
 * session; re-probing costs a null return.
 */
export function cpWebglSupport(): CpWebglSupport {
  if (cached?.supported) return cached;
  cached = probeCpWebglSupport();
  return cached;
}

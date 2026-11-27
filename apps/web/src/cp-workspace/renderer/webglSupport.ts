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
  stencil: true,
  alpha: false,
  premultipliedAlpha: true,
  // On-demand renderer: we only redraw on mount/resize/state change, not every
  // frame, so preserve the buffer to survive compositor repaints between
  // renders. (Revisit if we move to continuous per-frame drawing.)
  preserveDrawingBuffer: true,
};

/** The one extension the renderer cannot run without. */
export const CP_REQUIRED_EXTENSION = 'ANGLE_instanced_arrays';

/**
 * Ask for the required extension the way regl asks for it.
 *
 * regl lowercases every name before the lookup (`tryLoadExtension`, regl.js:1021), and the
 * WebGL spec matches extension names case-insensitively, so on a conforming browser this is
 * the same question as asking in the canonical case. Where the two differ, regl's is the
 * one that decides whether the renderer starts — so it is the only one worth asking.
 *
 * This is a real gap between the probe and the renderer, independent of whether it explains
 * any particular failure: they were asking different questions, and a browser that answered
 * them differently would get a probe that says "supported", a regl that throws
 * "extension is not supported", and a {@link classifyCpWebglFailure} that finds the canvas
 * healthy and reports the gap as `unclassified` — which is the exact signature of
 * ORI-STUDIO-4. Asking regl's question makes the disagreement impossible to have rather
 * than merely unlikely.
 */
function hasRequiredExtension(gl: WebGLRenderingContext): boolean {
  try {
    return Boolean(gl.getExtension(CP_REQUIRED_EXTENSION.toLowerCase()));
  } catch {
    // Same as regl, which swallows a throwing `getExtension` and treats it as a miss.
    return false;
  }
}

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
   * GPU — see {@link cpWebglContextGap}.
   */
  | 'context-lost-at-start'
  /**
   * The context was live when the renderer started building on it and stopped
   * answering partway: one of the renderer's shaders failed, and so does a
   * trivial one asked straight after (ORI-STUDIO-1D, whose info log was empty).
   *
   * This is a context being lost mid-compile, seen from the inside. The GPU
   * process has gone, every query answers its default — `COMPILE_STATUS` false,
   * an empty log — and the browser has not yet told the page, so
   * `isContextLost()` still says no. It is handled as the loss it is about to be
   * reported as, not as a shader the driver rejects.
   */
  | 'context-failed';

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
    case 'context-failed':
      return 'WebGL context stopped responding while the renderer was starting';
  }
}

/**
 * The renderer would not start because of the graphics stack, not because of a
 * bug: thrown by `createReglRenderer` in place of regl's own message, which
 * reads "try upgrading your browser or graphics drivers" for every one of these
 * and so cannot tell the host which of them it is looking at.
 */
export class CpWebglUnavailableError extends Error {
  readonly gap: CpWebglGap;

  constructor(gap: CpWebglGap, options?: { cause?: unknown }) {
    super(describeCpWebglGap(gap), options);
    this.name = 'CpWebglUnavailableError';
    this.gap = gap;
  }
}

/**
 * The gaps that pass on their own: the browser took a context away and will
 * hand it back. The host waits for `webglcontextrestored` and rebuilds, exactly
 * as for a loss mid-session. The others are this machine's graphics stack as it
 * stands, and only the user can change them.
 */
export function isTransientCpWebglGap(gap: CpWebglGap): boolean {
  return gap === 'context-lost-at-start' || gap === 'context-failed';
}

/**
 * Why a crease-pattern canvas is not drawing, for `CpRendererUnavailable`.
 *
 * Two states, because they call for opposite things from the user. `unsupported`
 * is this graphics stack as it stands, and only a change to it will help.
 * `context-lost` is a blip on hardware that was drawing a moment ago, and the
 * only useful instruction is to wait.
 */
export type CpRendererStatus =
  /**
   * No usable WebGL. `gap` names the missing capability, and is null for a
   * failure that is none of them; `detail` is the gap described, or the thrown
   * error's message.
   */
  | { kind: 'unsupported'; gap: CpWebglGap | null; detail: string | null }
  /**
   * The context was taken away; a rebuild is waiting on `webglcontextrestored`.
   * `gap` says how the renderer met it, and is absent for a loss mid-session.
   */
  | { kind: 'context-lost'; gap?: CpWebglGap };

/**
 * What a host does about a renderer that would not start.
 *
 * - `wait`: a context the browser took and will return. Said so, rebuilt on
 *   restore, and not an error — it is the same event as a loss mid-session.
 * - `unsupported`: this graphics stack cannot draw the canvas. The user is told
 *   what to change; how often it happens is a product-analytics question
 *   (`cp canvas unavailable`), not a crash report, because nothing in Ori Studio
 *   is broken.
 * - `unexpected`: something regl threw that is none of the above — a shader a
 *   working driver rejects, say. That one is ours to fix, so it is reported.
 */
export type CpRendererStartFailure =
  | { kind: 'wait'; status: CpRendererStatus }
  | { kind: 'unsupported'; status: CpRendererStatus }
  | { kind: 'unexpected'; status: CpRendererStatus };

export function cpRendererStartFailure(error: unknown): CpRendererStartFailure {
  if (!(error instanceof CpWebglUnavailableError)) {
    return {
      kind: 'unexpected',
      status: {
        kind: 'unsupported',
        gap: null,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  const { gap } = error;
  return isTransientCpWebglGap(gap)
    ? { kind: 'wait', status: { kind: 'context-lost', gap } }
    : { kind: 'unsupported', status: { kind: 'unsupported', gap, detail: describeCpWebglGap(gap) } };
}

/**
 * regl's own lookup order, all three names of it (`createContext`, regl.js:863).
 * The probe gates the real path, so anything it refuses to try is a context the
 * renderer can no longer get — it must not be the stricter of the two.
 */
const CONTEXT_NAMES = ['webgl', 'experimental-webgl', 'webgl-experimental'] as const;

/**
 * Get a context the way regl would (`createContext`, regl.js:864). The renderer
 * asks through this rather than handing regl the canvas, so that it — not regl —
 * owns the canvas's context-loss events; see `createReglRenderer`.
 *
 * Asking again for a canvas that already has a context returns that context, so
 * this also observes a context rather than creating a second one.
 */
export function acquireCpWebglContext(
  canvas: HTMLCanvasElement,
  attributes: WebGLContextAttributes = CP_GL_ATTRIBUTES
): WebGLRenderingContext | null {
  for (const name of CONTEXT_NAMES) {
    try {
      const gl = canvas.getContext(name, attributes);
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
  const gl = acquireCpWebglContext(canvas);
  if (!gl) return { supported: false, gap: 'no-context' };
  try {
    // A throwaway context that comes back lost says the document is short of
    // contexts right now, not that the machine lacks the extension — which is
    // what every `getExtension` on it would otherwise claim.
    const gap = cpWebglContextGap(gl);
    return gap === null ? { supported: true } : { supported: false, gap };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * What stops the renderer starting on *this* context, asked before regl is.
 *
 * The probe and the real canvas can disagree, and when they do the user is told
 * the wrong thing. The probe runs on a throwaway 1×1 canvas and hands the
 * context slot straight back; the renderer runs on the real one, moments later,
 * on a document that may by then hold several live contexts. A stack that
 * granted the first can still fail the second — and WebKit fails it by handing
 * back a context that is already lost rather than by returning null. Every
 * `getExtension` on a lost context returns null, so left to regl this raises its
 * missing-extension error and the editor tells someone with a perfectly capable
 * GPU to upgrade their system. Hence the order: lost before missing.
 *
 * Returns `null` for a context the renderer can start on.
 *
 * Deliberately **not** the probe: nothing here calls `loseContext`, which on the
 * real canvas would destroy the context the renderer is about to draw with.
 */
export function cpWebglContextGap(gl: WebGLRenderingContext | null): CpWebglGap | null {
  if (!gl) return 'no-context';
  if (gl.isContextLost()) return 'context-lost-at-start';
  if (!hasRequiredExtension(gl)) return 'no-instanced-arrays';
  return null;
}

/** The smallest shader there is: if this does not compile, nothing will. */
const TRIVIAL_VERTEX_SHADER = 'void main() { gl_Position = vec4(0.0); }';

/**
 * Whether the context can compile anything at all right now.
 *
 * Asked only after one of the renderer's own shaders has failed, to tell the
 * two causes apart: a driver that rejects *our* shader still compiles this one,
 * while a context that has stopped answering fails it the same way.
 */
export function contextCompilesShaders(gl: WebGLRenderingContext): boolean {
  if (gl.isContextLost()) return false;
  const shader = gl.createShader(gl.VERTEX_SHADER);
  if (!shader) return false;
  try {
    gl.shaderSource(shader, TRIVIAL_VERTEX_SHADER);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true;
  } finally {
    gl.deleteShader(shader);
  }
}

/**
 * Why building the renderer on a context that started out healthy failed.
 *
 * A context that is lost now, or that cannot compile even a trivial shader, is
 * the `context-failed` gap: the GPU went away mid-build. Anything else is
 * returned as it was thrown — claiming a gap we cannot see would tell the user
 * to change a machine that is fine, and hide a bug of ours that is not.
 */
export function cpWebglBuildFailure(gl: WebGLRenderingContext, error: unknown): unknown {
  if (error instanceof CpWebglUnavailableError) return error;
  if (!contextCompilesShaders(gl)) return new CpWebglUnavailableError('context-failed', { cause: error });
  return error;
}

/**
 * Wait on a canvas whose context was lost, or stopped answering, before the renderer could
 * start on it.
 *
 * The renderer owns the canvas's context-loss events while it lives, and it never got that
 * far, so nothing is holding the door open for a restore. This does the two things the
 * renderer would have: it `preventDefault()`s the `webglcontextlost` the browser queues for
 * a context created lost (or lost mid-build), which is what marks the context as one the
 * page wants back, and it calls `onRestored` on `webglcontextrestored` so the host can
 * rebuild on the same canvas, which by then hands out a live context again.
 *
 * Returns the disposer; the host returns it from the same effect that would have owned the
 * renderer.
 */
export function awaitContextRestore(canvas: HTMLCanvasElement, onRestored: () => void): () => void {
  const onLost = (event: Event) => event.preventDefault();
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
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

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireCpWebglContext,
  awaitContextRestore,
  contextCompilesShaders,
  CP_REQUIRED_EXTENSION,
  cpRendererStartFailure,
  cpWebglBuildFailure,
  cpWebglContextGap,
  cpWebglSupport,
  CpWebglUnavailableError,
  describeCpWebglGap,
  probeCpWebglSupport,
} from './webglSupport';

/**
 * Stub `getContext` for the probe's throwaway canvas. `extensions` names the
 * extensions the fake context admits to; anything else answers null, which is
 * what a real context does for one it does not implement.
 *
 * Matching is case-insensitive, as the WebGL spec requires — `caseSensitive` models the
 * browser that is not, which is the one case where asking in the canonical case and asking
 * the way regl asks give different answers.
 *
 * `lost` models the case a real lost context presents: `isContextLost()` is true
 * *and* every `getExtension` answers null, which is why the two have to be asked
 * in that order to tell them apart.
 */
function stubContext(options: {
  context: boolean;
  extensions?: readonly string[];
  lost?: boolean;
  caseSensitive?: boolean;
}) {
  const lose = vi.fn();
  const declared = options.extensions ?? [];
  const supports = (name: string) =>
    options.caseSensitive
      ? declared.includes(name)
      : declared.some((entry) => entry.toLowerCase() === name.toLowerCase());
  const getExtension = (name: string) =>
    name === 'WEBGL_lose_context'
      ? { loseContext: lose }
      : !options.lost && supports(name)
        ? {}
        : null;
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() =>
      options.context
        ? ({ getExtension, isContextLost: () => options.lost === true } as unknown as null)
        : null
    );
  return { lose, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probeCpWebglSupport', () => {
  it('reports no-context when WebGL is unavailable', () => {
    stubContext({ context: false });
    expect(probeCpWebglSupport()).toEqual({ supported: false, gap: 'no-context' });
  });

  // The gap that used to reach the user as regl's "try upgrading your system or
  // a different browser", indistinguishable from having no WebGL at all.
  it('reports no-instanced-arrays for a context without the extension', () => {
    stubContext({ context: true, extensions: [] });
    expect(probeCpWebglSupport()).toEqual({ supported: false, gap: 'no-instanced-arrays' });
  });

  it('accepts a WebGL1 context that has instanced arrays', () => {
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION] });
    expect(probeCpWebglSupport()).toEqual({ supported: true });
  });

  // Contexts are a capped per-document resource, and this one exists only to be
  // interrogated — holding it would cost the app a slot it needs to draw with.
  it('releases the probe context once it has its answer', () => {
    const { lose } = stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION] });
    probeCpWebglSupport();
    expect(lose).toHaveBeenCalledOnce();
  });

  // One `getContext` returning null can just mean the document is out of
  // context slots, which this app can reach with several GL canvases open on a
  // device that reclaims them. Remembering that answer would leave the editor
  // permanently "unsupported" on hardware that supports it fine.
  it('re-probes after a no, and keeps a yes', () => {
    stubContext({ context: false });
    expect(cpWebglSupport()).toEqual({ supported: false, gap: 'no-context' });

    vi.restoreAllMocks();
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION] });
    expect(cpWebglSupport()).toEqual({ supported: true });

    vi.restoreAllMocks();
    const { spy } = stubContext({ context: false });
    expect(cpWebglSupport()).toEqual({ supported: true });
    expect(spy).not.toHaveBeenCalled();
  });

  // regl lowercases every extension name before looking it up, so on a browser that
  // matches case-sensitively the canonical name resolves and regl's does not. Asking in
  // the canonical case put the probe *ahead* of the renderer: it said supported, regl then
  // threw, and the user was told to upgrade a machine that was fine.
  it('agrees with regl on a browser that matches extension names case-sensitively', () => {
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION], caseSensitive: true });
    expect(probeCpWebglSupport()).toEqual({ supported: false, gap: 'no-instanced-arrays' });
  });

  // WebKit answers a document short of contexts with one that is already lost,
  // and every `getExtension` on it is null. Read as a missing extension, that
  // told the user their machine could not do instanced drawing.
  it('reports a probe context that came back lost as lost, not as a missing extension', () => {
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION], lost: true });
    expect(probeCpWebglSupport()).toEqual({ supported: false, gap: 'context-lost-at-start' });
  });

  it('names each gap distinctly', () => {
    const described = (
      ['no-context', 'no-instanced-arrays', 'context-lost-at-start', 'context-failed'] as const
    ).map(describeCpWebglGap);
    expect(new Set(described).size).toBe(described.length);
    expect(describeCpWebglGap('no-instanced-arrays')).toContain(CP_REQUIRED_EXTENSION);
  });
});

/**
 * Asked of the real canvas before regl is built, because the probe passing and
 * the real canvas failing is a real combination, and the user was being told the
 * wrong thing when it happened (ORI-STUDIO-4). What it must never do is agree
 * with regl by default.
 */
describe('cpWebglContextGap', () => {
  const gapOf = () => cpWebglContextGap(acquireCpWebglContext(document.createElement('canvas')));

  it('separates an exhausted document from an incapable one', () => {
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION], lost: true });
    expect(gapOf()).toBe('context-lost-at-start');
  });

  // The same observable symptom as above — every getExtension answers null — and
  // the only thing that distinguishes them is that this context is alive.
  it('reports no-instanced-arrays for a live context missing the extension', () => {
    stubContext({ context: true, extensions: [] });
    expect(gapOf()).toBe('no-instanced-arrays');
  });

  it('reports no-context when the canvas has none', () => {
    stubContext({ context: false });
    expect(gapOf()).toBe('no-context');
  });

  it('finds no gap on a healthy context', () => {
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION] });
    expect(gapOf()).toBeNull();
  });

  // regl lowercases the name before it asks; asking any other way would find a
  // healthy context where regl finds none.
  it('names the gap regl would hit on a case-sensitive browser', () => {
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION], caseSensitive: true });
    expect(gapOf()).toBe('no-instanced-arrays');
  });

  // The probe may throw its context away; the real canvas may not. The renderer
  // is about to draw with the context this just inspected.
  it('leaves the inspected context alive', () => {
    const { lose } = stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION] });
    gapOf();
    expect(lose).not.toHaveBeenCalled();
  });
});

/** A context that compiles every shader, or none. */
function shaderContext({ compiles, lost = false }: { compiles: boolean; lost?: boolean }) {
  return {
    VERTEX_SHADER: 0x8b31,
    COMPILE_STATUS: 0x8b81,
    isContextLost: () => lost,
    createShader: () => (lost ? null : {}),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: () => (lost ? null : compiles),
    deleteShader: vi.fn(),
  } as unknown as WebGLRenderingContext;
}

/**
 * ORI-STUDIO-1D: a fragment shader that "failed to compile" with an empty info
 * log on a context that `isContextLost()` still called healthy. That is what a
 * context lost mid-compile looks like from the inside, and it is a loss to wait
 * out — but a shader a working driver rejects is a bug of ours, and the two must
 * not be mistaken for each other in either direction.
 */
describe('cpWebglBuildFailure', () => {
  const COMPILE_ERROR = new Error('(regl) Error compiling fragment shader, unknown');

  it('names a context that can compile nothing at all', () => {
    const failure = cpWebglBuildFailure(shaderContext({ compiles: false }), COMPILE_ERROR);
    expect(failure).toBeInstanceOf(CpWebglUnavailableError);
    expect((failure as CpWebglUnavailableError).gap).toBe('context-failed');
    expect((failure as CpWebglUnavailableError).cause).toBe(COMPILE_ERROR);
  });

  it('names a context lost by the time it is asked', () => {
    const failure = cpWebglBuildFailure(shaderContext({ compiles: true, lost: true }), COMPILE_ERROR);
    expect((failure as CpWebglUnavailableError).gap).toBe('context-failed');
  });

  it('returns the error as thrown when the context compiles fine', () => {
    expect(cpWebglBuildFailure(shaderContext({ compiles: true }), COMPILE_ERROR)).toBe(COMPILE_ERROR);
  });

  it('cleans up the shader it compiled to find out', () => {
    const gl = shaderContext({ compiles: true });
    expect(contextCompilesShaders(gl)).toBe(true);
    expect(gl.deleteShader).toHaveBeenCalledOnce();
  });
});

/**
 * Which start-up failures are errors. ORI-STUDIO-4 (no WebGL on the canvas) and
 * -1D (a context that stopped answering mid-build) are the machine's, not ours:
 * the first is explained in place of the canvas, the second waited out like any
 * lost context, and neither is reported. Only what nothing can name is.
 */
describe('cpRendererStartFailure', () => {
  it('explains a missing capability without reporting it', () => {
    expect(cpRendererStartFailure(new CpWebglUnavailableError('no-context'))).toEqual({
      kind: 'unsupported',
      status: { kind: 'unsupported', gap: 'no-context', detail: describeCpWebglGap('no-context') },
    });
    expect(cpRendererStartFailure(new CpWebglUnavailableError('no-instanced-arrays')).kind).toBe(
      'unsupported'
    );
  });

  it('waits out a context lost before or while the renderer started', () => {
    for (const gap of ['context-lost-at-start', 'context-failed'] as const) {
      expect(cpRendererStartFailure(new CpWebglUnavailableError(gap))).toEqual({
        kind: 'wait',
        status: { kind: 'context-lost', gap },
      });
    }
  });

  it('keeps anything else as unexpected, with its own message', () => {
    expect(cpRendererStartFailure(new Error('(regl) something else'))).toEqual({
      kind: 'unexpected',
      status: { kind: 'unsupported', gap: null, detail: '(regl) something else' },
    });
  });
});

describe('awaitContextRestore', () => {
  it('keeps the queued loss restorable and rebuilds on restore, once armed', () => {
    const element = document.createElement('canvas');
    const onRestored = vi.fn();
    const dispose = awaitContextRestore(element, onRestored);

    // The browser's loss notice for a context created lost: default-prevented is what
    // marks the context as one the page wants back.
    const lost = new Event('webglcontextlost', { cancelable: true });
    element.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(onRestored).not.toHaveBeenCalled();

    element.dispatchEvent(new Event('webglcontextrestored'));
    expect(onRestored).toHaveBeenCalledTimes(1);

    // Disposed with the effect that armed it: a restore after that belongs to the
    // renderer that replaced it, which listens for itself.
    dispose();
    element.dispatchEvent(new Event('webglcontextrestored'));
    const later = new Event('webglcontextlost', { cancelable: true });
    element.dispatchEvent(later);
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(later.defaultPrevented).toBe(false);
  });
});

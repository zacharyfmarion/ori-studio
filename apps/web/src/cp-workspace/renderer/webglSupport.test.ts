import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyCpWebglFailure,
  CP_REQUIRED_EXTENSION,
  cpWebglSupport,
  describeCpWebglGap,
  probeCpWebglSupport,
} from './webglSupport';

/**
 * Stub `getContext` for the probe's throwaway canvas. `extensions` names the
 * extensions the fake context admits to; anything else answers null, which is
 * what a real context does for one it does not implement.
 *
 * `lost` models the case a real lost context presents: `isContextLost()` is true
 * *and* every `getExtension` answers null, which is why the two have to be asked
 * in that order to tell them apart.
 */
function stubContext(options: {
  context: boolean;
  extensions?: readonly string[];
  lost?: boolean;
}) {
  const lose = vi.fn();
  const extensions = new Set(options.extensions ?? []);
  const getExtension = (name: string) =>
    name === 'WEBGL_lose_context'
      ? { loseContext: lose }
      : !options.lost && extensions.has(name)
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

  it('names each gap distinctly', () => {
    const described = (['no-context', 'no-instanced-arrays', 'context-lost-at-start'] as const).map(
      describeCpWebglGap
    );
    expect(new Set(described).size).toBe(described.length);
    expect(describeCpWebglGap('no-instanced-arrays')).toContain(CP_REQUIRED_EXTENSION);
  });
});

/**
 * The classifier exists because the probe passing and regl throwing is a real
 * combination, and the user was being told the wrong thing when it happened
 * (ORI-STUDIO-4). What it must never do is agree with regl by default.
 */
describe('classifyCpWebglFailure', () => {
  const canvas = () => document.createElement('canvas');

  it('separates an exhausted document from an incapable one', () => {
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION], lost: true });
    expect(classifyCpWebglFailure(canvas())).toBe('context-lost-at-start');
  });

  // The same observable symptom as above — every getExtension answers null — and
  // the only thing that distinguishes them is that this context is alive.
  it('reports no-instanced-arrays for a live context missing the extension', () => {
    stubContext({ context: true, extensions: [] });
    expect(classifyCpWebglFailure(canvas())).toBe('no-instanced-arrays');
  });

  it('reports no-context when the canvas has none', () => {
    stubContext({ context: false });
    expect(classifyCpWebglFailure(canvas())).toBe('no-context');
  });

  // regl throws for things that are not capability gaps at all — a shader that
  // will not compile, say. Naming a gap here would be the same wrong answer the
  // classifier was added to stop, pointing the other way.
  it('declines to name a gap on a healthy canvas, so the raw error survives', () => {
    stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION] });
    expect(classifyCpWebglFailure(canvas())).toBeNull();
  });

  // The probe may throw this away; the real canvas may not. The caller is about
  // to report on the context this just inspected.
  it('leaves the inspected context alive', () => {
    const { lose } = stubContext({ context: true, extensions: [CP_REQUIRED_EXTENSION] });
    classifyCpWebglFailure(canvas());
    expect(lose).not.toHaveBeenCalled();
  });
});

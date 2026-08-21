import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CP_REQUIRED_EXTENSION,
  cpWebglSupport,
  describeCpWebglGap,
  probeCpWebglSupport,
} from './webglSupport';

/**
 * Stub `getContext` for the probe's throwaway canvas. `extensions` names the
 * extensions the fake context admits to; anything else answers null, which is
 * what a real context does for one it does not implement.
 */
function stubContext(options: { context: boolean; extensions?: readonly string[] }) {
  const lose = vi.fn();
  const extensions = new Set(options.extensions ?? []);
  const getExtension = (name: string) =>
    name === 'WEBGL_lose_context'
      ? { loseContext: lose }
      : extensions.has(name)
        ? {}
        : null;
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => (options.context ? ({ getExtension } as unknown as null) : null));
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
    expect(describeCpWebglGap('no-context')).not.toEqual(
      describeCpWebglGap('no-instanced-arrays')
    );
    expect(describeCpWebglGap('no-instanced-arrays')).toContain(CP_REQUIRED_EXTENSION);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { GlCore, WebGlContextLostError } from '../src/webgl/glCore.js';

// WebGL2 does not exist in Node, so these cover the loss bookkeeping only: that
// the event is observed on both spellings, that the first GL touch afterwards
// throws instead of silently no-opping, and that listeners fire once. The GL
// behaviour itself is covered by the browser parity bench.

interface FakeGl {
  isContextLost: () => boolean;
  getExtension: (name: string) => unknown;
  disable: () => void;
  createBuffer: () => object;
  bindBuffer: () => void;
  bufferData: () => void;
}

/** A canvas whose getContext yields a minimally viable fake WebGL2 context. */
function fakeCanvas(options: { lost?: boolean } = {}) {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  let lost = options.lost ?? false;
  const gl: FakeGl = {
    isContextLost: () => lost,
    getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null),
    disable: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
  };
  const canvas = {
    getContext: () => gl,
    addEventListener(type: string, handler: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: (event: Event) => void) {
      listeners.get(type)?.delete(handler);
    },
  };
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    /** Dispatch a loss event of the given name, as the browser would. */
    fire(type: string) {
      const prevented = { value: false };
      const event = {
        type,
        preventDefault: () => {
          prevented.value = true;
        },
      } as unknown as Event;
      for (const handler of listeners.get(type) ?? []) handler(event);
      return prevented.value;
    },
    setDriverLost(value: boolean) {
      lost = value;
    },
  };
}

describe('GlCore context loss', () => {
  it('starts live', () => {
    const { canvas } = fakeCanvas();
    const core = GlCore.create(canvas);
    expect(core?.contextLost).toBe(false);
  });

  // HTMLCanvasElement fires the legacy name; OffscreenCanvas fires the modern
  // one. The worker path -- the one that actually hits the per-worker context
  // cap -- is the OffscreenCanvas one, so missing it would defeat the purpose.
  it.each(['webglcontextlost', 'contextlost'])('observes %s', (eventName) => {
    const harness = fakeCanvas();
    const core = GlCore.create(harness.canvas);
    const handler = vi.fn();
    core!.onContextLost(handler);

    const prevented = harness.fire(eventName);

    expect(core!.contextLost).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    // Without preventDefault the context is gone for good rather than restorable.
    expect(prevented).toBe(true);
  });

  it('notifies each listener once, however many events arrive', () => {
    const harness = fakeCanvas();
    const core = GlCore.create(harness.canvas);
    const handler = vi.fn();
    core!.onContextLost(handler);

    harness.fire('webglcontextlost');
    harness.fire('contextlost');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops notifying an unsubscribed listener', () => {
    const harness = fakeCanvas();
    const core = GlCore.create(harness.canvas);
    const handler = vi.fn();
    core!.onContextLost(handler)();

    harness.fire('webglcontextlost');

    expect(handler).not.toHaveBeenCalled();
  });

  it('throws on the first GL touch after loss instead of no-opping', () => {
    const harness = fakeCanvas();
    const core = GlCore.create(harness.canvas);
    harness.fire('webglcontextlost');

    // A lost context makes every call a silent no-op and every read return
    // zeros, which a solver would happily report as a settled, motionless mesh.
    expect(() => core!.createTexture('u_position', { width: 2, height: 2, data: null })).toThrow(
      WebGlContextLostError
    );
    expect(() => core!.readTexture('u_position')).toThrow(WebGlContextLostError);
  });

  it('detects a loss the driver reports before any event arrives', () => {
    const harness = fakeCanvas();
    const core = GlCore.create(harness.canvas);
    const handler = vi.fn();
    core!.onContextLost(handler);

    harness.setDriverLost(true);

    expect(core!.contextLost).toBe(true);
    expect(() => core!.step('normalCalc', [], 'u_normals')).toThrow(WebGlContextLostError);
    // The event never fired, so the throw path is what surfaces it to listeners.
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ViewTransform } from './types';
import type { CpRenderFrame } from './CpRenderer';

/**
 * The context-loss contract, which is the one graphics failure that strikes a
 * device already drawing happily: iOS reclaims GL contexts under memory
 * pressure. The host must be told at loss and again at restore, and must not be
 * told to rebuild in between — `getContext` hands back the same dead context
 * until the browser restores it, so a rebuild attempted at loss fails with the
 * error a machine with no WebGL at all produces.
 */

const listeners = new Map<string, () => void>();
const clear = vi.fn();

vi.mock('regl', () => ({
  default: () => ({
    poll: () => {},
    clear,
    destroy: () => {},
    buffer: () => ({ destroy: () => {} }),
    texture: () => ({ destroy: () => {} }),
    on: (type: string, callback: () => void) => {
      listeners.set(type, callback);
      return { cancel: () => listeners.delete(type) };
    },
  }),
}));

const noopProgram = () => ({ setData: () => {}, draw: () => {}, dispose: () => {} });
vi.mock('./programs/strokeProgram', () => ({ createStrokeProgram: noopProgram }));
vi.mock('./programs/pointProgram', () => ({ createPointProgram: noopProgram }));
vi.mock('./programs/fillProgram', () => ({ createFillProgram: noopProgram }));
vi.mock('./programs/markerProgram', () => ({ createMarkerProgram: noopProgram }));
vi.mock('./programs/wedgeProgram', () => ({ createWedgeProgram: noopProgram }));
vi.mock('./programs/imageProgram', () => ({ createImageProgram: noopProgram }));

const { createReglRenderer } = await import('./reglRenderer');

const VIEW: ViewTransform = { origin: [0, 0], ex: [1, 0], ey: [0, 1] };
const FRAME: CpRenderFrame = {
  clearColor: [0, 0, 0, 1],
  view: VIEW,
  userView: VIEW,
  strokeWidthPx: 1,
  userScalePx: 1,
  markerScalePx: 1,
  pointScalePx: 1,
  constantOutlinePx: 1,
  markerOutlinePx: 1,
  pointOutlinePx: 1,
  pointOpacity: 1,
};

function mountRenderer() {
  listeners.clear();
  clear.mockClear();
  const onContextLost = vi.fn();
  const onContextRestored = vi.fn();
  const renderer = createReglRenderer(document.createElement('canvas'), {
    onContextLost,
    onContextRestored,
  });
  renderer.resize({ width: 100, height: 100, dpr: 1 });
  return { renderer, onContextLost, onContextRestored };
}

describe('reglRenderer context loss', () => {
  it('subscribes to regl rather than the canvas, so restore runs after regl has rebuilt its objects', () => {
    mountRenderer();
    expect([...listeners.keys()].sort()).toEqual(['lost', 'restore']);
  });

  it('reports loss and restore separately', () => {
    const { onContextLost, onContextRestored } = mountRenderer();

    listeners.get('lost')?.();
    expect(onContextLost).toHaveBeenCalledOnce();
    // Nothing may ask for a rebuild yet: the context is still dead.
    expect(onContextRestored).not.toHaveBeenCalled();

    listeners.get('restore')?.();
    expect(onContextRestored).toHaveBeenCalledOnce();
  });

  it('draws nothing while the context is lost, and draws again once it is back', () => {
    const { renderer } = mountRenderer();

    renderer.render(FRAME);
    expect(clear).toHaveBeenCalledTimes(1);

    listeners.get('lost')?.();
    renderer.render(FRAME);
    expect(clear).toHaveBeenCalledTimes(1);

    listeners.get('restore')?.();
    renderer.render(FRAME);
    expect(clear).toHaveBeenCalledTimes(2);
  });
});

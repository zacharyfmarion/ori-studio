vi.mock('./programs/spreadProgram', () => ({createSpreadProgram:()=>({setData:()=>{},draw:()=>{},dispose:()=>{}})}));
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ViewTransform } from './types';
import type { CpRenderFrame } from './CpRenderer';

/**
 * The context-loss contract, which is the one graphics failure that strikes a
 * device already drawing happily: iOS reclaims GL contexts under memory
 * pressure, and a document short of contexts has them taken. The host must be
 * told at loss and again at restore, and must not be told to rebuild in between
 * — `getContext` hands back the same dead context until the browser restores
 * it, so a rebuild attempted at loss fails with the error a machine with no
 * WebGL at all produces.
 *
 * What a lost renderer may do is covered with the real programs in
 * `reglRendererLostContext.test.ts`; this is the frame loop.
 */

const clear = vi.fn();

vi.mock('regl', () => ({
  default: () => ({
    poll: () => {},
    clear,
    destroy: () => {},
    buffer: () => ({ destroy: () => {} }),
    texture: () => ({ destroy: () => {} }),
  }),
}));

const noopProgram = () => ({ setData: () => {}, draw: () => {}, dispose: () => {} });
vi.mock('./programs/strokeProgram', () => ({ createStrokeProgram: noopProgram }));
vi.mock('./programs/pointProgram', () => ({ createPointProgram: noopProgram }));
vi.mock('./programs/fillProgram', () => ({ createFillProgram: noopProgram }));
vi.mock('./programs/shadowProgram', () => ({ createShadowProgram: noopProgram }));
vi.mock('./programs/markerProgram', () => ({ createMarkerProgram: noopProgram }));
vi.mock('./programs/wedgeProgram', () => ({ createWedgeProgram: noopProgram }));
vi.mock('./programs/imageProgram', () => ({ createImageProgram: noopProgram }));
vi.mock('./programs/regionProgram', () => ({ createRegionProgram: noopProgram }));

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
  clear.mockClear();
  const gl = {
    lost: false,
    isContextLost() {
      return this.lost;
    },
    getExtension(name: string) {
      return !this.lost && name.toLowerCase() === 'angle_instanced_arrays' ? {} : null;
    },
  };
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { value: () => gl });
  const onContextLost = vi.fn();
  const onContextRestored = vi.fn();
  const renderer = createReglRenderer(canvas, { onContextLost, onContextRestored });
  renderer.resize({ width: 100, height: 100, dpr: 1 });
  const lose = () => {
    gl.lost = true;
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  };
  const restore = () => {
    gl.lost = false;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
  };
  return { renderer, onContextLost, onContextRestored, lose, restore };
}

describe('reglRenderer context loss', () => {
  it('reports loss and restore separately', () => {
    const { onContextLost, onContextRestored, lose, restore } = mountRenderer();

    lose();
    expect(onContextLost).toHaveBeenCalledOnce();
    // Nothing may ask for a rebuild yet: the context is still dead.
    expect(onContextRestored).not.toHaveBeenCalled();

    restore();
    expect(onContextRestored).toHaveBeenCalledOnce();
  });

  // The restore is the host's cue to build a replacement. This renderer's GL
  // objects went with the old context, so drawing with it again would only
  // issue calls against objects the new context has never heard of.
  it('draws nothing once the context is lost, and nothing after it is back', () => {
    const { renderer, lose, restore } = mountRenderer();

    renderer.render(FRAME);
    expect(clear).toHaveBeenCalledTimes(1);

    lose();
    renderer.render(FRAME);
    expect(clear).toHaveBeenCalledTimes(1);

    restore();
    renderer.render(FRAME);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

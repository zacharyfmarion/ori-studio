/**
 * A canvas whose `getContext` hands out a live WebGL1 context with instanced
 * arrays: what `createReglRenderer` asks of a canvas before regl is built, for
 * tests that mock regl itself. jsdom has no WebGL, so a bare canvas reads as a
 * machine without it.
 */
export function liveWebglCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const gl = {
    isContextLost: () => false,
    getExtension: (name: string) => (name.toLowerCase() === 'angle_instanced_arrays' ? {} : null),
  };
  Object.defineProperty(canvas, 'getContext', { value: () => gl });
  return canvas;
}

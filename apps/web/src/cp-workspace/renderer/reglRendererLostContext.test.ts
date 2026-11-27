// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CpRenderer } from './CpRenderer';
import type {
  FillGeometry,
  MarkerGeometry,
  PointGeometry,
  StrokeGeometry,
  WedgeGeometry,
} from './types';
import { EMPTY_SHADOW_GEOMETRY } from './types';

/**
 * The renderer against a lost WebGL context, with the real draw programs over a
 * regl stand-in that keeps the three behaviours of regl 2.1.1 these failures
 * came from:
 *
 * - A buffer or texture made while the context is lost has a null handle,
 *   because `gl.createBuffer()` returns null on a lost context.
 * - `destroy()` on a null handle throws `(regl) buffer must not be deleted
 *   already` (regl.js:1665), the message of ORI-STUDIO-1Q and -1R. regl reads a
 *   null handle as "destroyed before", whatever the reason it is null.
 * - Handed the canvas, regl installs its own context-loss listeners, and its
 *   restore relinks every program *before* it runs anyone's restore callback,
 *   raising from inside the listener when a link fails (ORI-STUDIO-1C).
 *   Handed a `gl`, it installs none (regl.js:10095).
 */

interface FakeGl {
  lost: boolean;
  compiles: boolean;
  isContextLost(): boolean;
  getExtension(name: string): object | null;
  getContextAttributes(): WebGLContextAttributes;
  VERTEX_SHADER: number;
  COMPILE_STATUS: number;
  createShader(type: number): object | null;
  shaderSource(): void;
  compileShader(): void;
  getShaderParameter(): boolean | null;
  deleteShader(): void;
}

const fake = vi.hoisted(() => {
  const control = {
    /** Make building a draw command throw, as a shader that will not compile does. */
    failCommand: false,
    /** Make regl's own restore throw at its relink, as in ORI-STUDIO-1C. */
    failRelink: false,
    instances: [] as Array<{ handedCanvas: boolean; destroyed: boolean }>,
  };

  function createRegl(args: { gl?: FakeGl; canvas?: HTMLCanvasElement }) {
    const gl = args.gl ?? (args.canvas?.getContext('webgl') as unknown as FakeGl);
    const instance = { handedCanvas: Boolean(args.canvas), destroyed: false };
    control.instances.push(instance);
    const resources = new Set<{ handle: object | null; kind: string }>();
    const lostCallbacks: Array<() => void> = [];
    const restoreCallbacks: Array<() => void> = [];
    let reglLost = false;

    const release = (resource: { handle: object | null; kind: string }) => {
      if (!resource.handle) throw new Error(`(regl) ${resource.kind} must not be deleted already`);
      resource.handle = null;
      resources.delete(resource);
    };
    const resource = (kind: string) => {
      const entry = { handle: gl.isContextLost() ? null : {}, kind };
      resources.add(entry);
      const handle = Object.assign(() => handle, {
        destroy: () => release(entry),
        subdata: () => handle,
      });
      return handle;
    };

    const onLost = (event: Event) => {
      event.preventDefault();
      reglLost = true;
      for (const callback of lostCallbacks) callback();
    };
    const onRestored = () => {
      reglLost = false;
      if (control.failRelink) {
        throw new Error('(regl) Error linking program with vertex shader, "unknown", and fragment shader "unknown"');
      }
      for (const entry of resources) entry.handle = {};
      for (const callback of restoreCallbacks) callback();
    };
    args.canvas?.addEventListener('webglcontextlost', onLost);
    args.canvas?.addEventListener('webglcontextrestored', onRestored);

    return Object.assign(
      () => {
        if (control.failCommand) throw new Error('(regl) Error compiling fragment shader, unknown');
        return () => {
          if (reglLost) throw new Error('(regl) context lost');
        };
      },
      {
        buffer: () => resource('buffer'),
        texture: () => resource('texture'),
        on: (type: string, callback: () => void) => {
          (type === 'lost' ? lostCallbacks : restoreCallbacks).push(callback);
          return { cancel: () => {} };
        },
        poll: () => {},
        clear: () => {},
        destroy: () => {
          instance.destroyed = true;
          args.canvas?.removeEventListener('webglcontextlost', onLost);
          args.canvas?.removeEventListener('webglcontextrestored', onRestored);
          for (const entry of [...resources]) release(entry);
        },
      }
    );
  }

  return { control, createRegl };
});

vi.mock('regl', () => ({ default: fake.createRegl }));
// Spread pictures are drawn by their own program, exercised in its own tests; a
// figure without spreads never creates one.
vi.mock('./programs/spreadProgram', () => ({
  createSpreadProgram: () => ({ setData: () => {}, draw: () => {}, dispose: () => {}, seesThrough: () => false }),
  placedSpreadView: (view: unknown) => view,
}));

const { createReglRenderer } = await import('./reglRenderer');
const { CpWebglUnavailableError } = await import('./webglSupport');

function fakeGl(): FakeGl {
  return {
    lost: false,
    compiles: true,
    isContextLost() {
      return this.lost;
    },
    getExtension(name: string) {
      return !this.lost && name.toLowerCase() === 'angle_instanced_arrays' ? {} : null;
    },
    getContextAttributes: () => ({}),
    VERTEX_SHADER: 0x8b31,
    COMPILE_STATUS: 0x8b81,
    createShader() {
      return this.lost ? null : {};
    },
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter() {
      return this.lost ? null : this.compiles;
    },
    deleteShader: () => {},
  };
}

function canvasWith(gl: FakeGl | null) {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { value: () => gl });
  return canvas;
}

function mount() {
  const gl = fakeGl();
  const canvas = canvasWith(gl);
  const onContextLost = vi.fn();
  const onContextRestored = vi.fn();
  const renderer = createReglRenderer(canvas, { onContextLost, onContextRestored });
  renderer.resize({ width: 100, height: 100, dpr: 1 });
  return { renderer, gl, canvas, onContextLost, onContextRestored };
}

/** The browser's order: the context is lost at once, and the page is told later. */
function loseContext(gl: FakeGl, canvas: HTMLCanvasElement, { announce = true } = {}) {
  gl.lost = true;
  if (announce) canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
}

function restoreContext(gl: FakeGl, canvas: HTMLCanvasElement) {
  gl.lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
}

const f32 = (n: number) => new Float32Array(n);
const POINTS: PointGeometry = {
  center: f32(2),
  radius: f32(1),
  screenSpace: f32(1),
  fill: f32(4),
  stroke: f32(4),
  count: 1,
};
const STROKES: StrokeGeometry = { a: f32(2), b: f32(2), color: f32(4), widthMul: f32(1), count: 1 };
const FILLS: FillGeometry = { position: f32(6), color: f32(12), count: 3, depth: f32(3) };
const MARKERS: MarkerGeometry = {
  center: f32(2),
  size: f32(1),
  shape: f32(1),
  fill: f32(4),
  stroke: f32(4),
  count: 1,
};
const WEDGES: WedgeGeometry = {
  center: f32(2),
  dir0: f32(2),
  dir1: f32(2),
  radiusPx: f32(1),
  color: f32(4),
  count: 1,
};

/** Every channel that uploads geometry, each with something to upload. */
const CHANNELS: ReadonlyArray<readonly [string, (renderer: CpRenderer) => void]> = [
  ['setOverlayPoints', (renderer) => renderer.setOverlayPoints(POINTS)],
  ['setPoints', (renderer) => renderer.setPoints(POINTS)],
  ['setStrokes', (renderer) => renderer.setStrokes(STROKES)],
  ['setGrid', (renderer) => renderer.setGrid(STROKES)],
  ['setPreview', (renderer) => renderer.setPreview(STROKES)],
  ['setOverlayFrame', (renderer) => renderer.setOverlayFrame(STROKES)],
  ['setSheetFill', (renderer) => renderer.setSheetFill(FILLS)],
  ['setSheetMarks', (renderer) => renderer.setSheetMarks(FILLS)],
  ['setDiagnosticFills', (renderer) => renderer.setDiagnosticFills(FILLS)],
  ['setDiagnosticMarkers', (renderer) => renderer.setDiagnosticMarkers(MARKERS)],
  ['setDiagnosticWedges', (renderer) => renderer.setDiagnosticWedges(WEDGES)],
  ['setImportedForms', (renderer) => renderer.setImportedForms({ fills: FILLS, strokes: STROKES })],
  [
    'setFolded',
    (renderer) => renderer.setFolded({ fills: FILLS, strokes: STROKES, shadows: EMPTY_SHADOW_GEOMETRY }),
  ],
];

afterEach(() => {
  fake.control.failCommand = false;
  fake.control.failRelink = false;
  fake.control.instances.length = 0;
});

describe('reglRenderer on a lost context', () => {
  // ORI-STUDIO-1Q: a pointer move re-armed the snap ring after Safari took the
  // context away; the second move's upload threw from inside the event listener.
  it.each(CHANNELS)('%s while lost leaves nothing the next upload cannot free', (_name, upload) => {
    const { renderer, gl, canvas } = mount();
    upload(renderer);
    loseContext(gl, canvas);

    expect(() => {
      upload(renderer);
      upload(renderer);
    }).not.toThrow();
  });

  // ORI-STUDIO-1R: the same buffer, met again by the unmount that followed.
  it.each(CHANNELS)('%s while lost still lets the renderer be disposed', (_name, upload) => {
    const { renderer, gl, canvas } = mount();
    upload(renderer);
    loseContext(gl, canvas);
    upload(renderer);

    expect(() => renderer.dispose()).not.toThrow();
  });

  // The page hears about a loss a task after the context is gone. Uploads in
  // that gap reach regl too, so the renderer asks the context, not only the event.
  it('uploads nothing between the loss and the page being told of it', () => {
    const { renderer, gl, canvas } = mount();
    renderer.setOverlayPoints(POINTS);
    loseContext(gl, canvas, { announce: false });

    expect(() => {
      renderer.setOverlayPoints(POINTS);
      renderer.setOverlayPoints(POINTS);
      renderer.dispose();
    }).not.toThrow();
  });
});

describe('reglRenderer context loss and restore', () => {
  it('leaves the canvas’s loss events to the renderer, not to regl', () => {
    mount();
    expect(fake.control.instances.map((instance) => instance.handedCanvas)).toEqual([false]);
  });

  it('tells the host of a loss once, and keeps the loss restorable', () => {
    const { canvas, gl, onContextLost, onContextRestored } = mount();
    gl.lost = true;
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);

    expect(lost.defaultPrevented).toBe(true);
    expect(onContextLost).toHaveBeenCalledOnce();
    expect(onContextRestored).not.toHaveBeenCalled();
  });

  // ORI-STUDIO-1C: regl's restore failed its relink inside its own listener, so
  // the callback that would have rebuilt the canvas never ran and the canvas
  // stayed on "Restoring…" for good. The host rebuilds from nothing anyway; it
  // only needs to hear that the context is back.
  it('tells the host the context is back even where regl’s relink would fail', () => {
    fake.control.failRelink = true;
    const { gl, canvas, onContextRestored } = mount();
    loseContext(gl, canvas);
    restoreContext(gl, canvas);

    expect(onContextRestored).toHaveBeenCalledOnce();
  });

  it('stops listening once disposed', () => {
    const { renderer, gl, canvas, onContextLost, onContextRestored } = mount();
    renderer.dispose();
    loseContext(gl, canvas);
    restoreContext(gl, canvas);

    expect(onContextLost).not.toHaveBeenCalled();
    expect(onContextRestored).not.toHaveBeenCalled();
  });
});

describe('reglRenderer start-up failures', () => {
  // ORI-STUDIO-4's message, which regl raises for every one of these gaps alike.
  it('names a canvas with no context', () => {
    expect(() => createReglRenderer(canvasWith(null))).toThrow(
      expect.objectContaining({ name: 'CpWebglUnavailableError', gap: 'no-context' })
    );
  });

  it('names a context that was lost before it started', () => {
    const gl = fakeGl();
    gl.lost = true;
    expect(() => createReglRenderer(canvasWith(gl))).toThrow(
      expect.objectContaining({ gap: 'context-lost-at-start' })
    );
  });

  // ORI-STUDIO-1D: a fragment shader that "failed" with an empty log, on a
  // context that could compile nothing at all a moment later.
  it('names a context that stopped answering while the programs were built', () => {
    fake.control.failCommand = true;
    const gl = fakeGl();
    gl.compiles = false;

    let thrown: unknown;
    try {
      createReglRenderer(canvasWith(gl));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CpWebglUnavailableError);
    expect((thrown as InstanceType<typeof CpWebglUnavailableError>).gap).toBe('context-failed');
    // Nothing of the half-built renderer outlives it.
    expect(fake.control.instances.every((instance) => instance.destroyed)).toBe(true);
  });

  // A shader a working driver rejects is a bug of ours, and must still say so.
  it('keeps regl’s own error when the context itself is healthy', () => {
    fake.control.failCommand = true;
    expect(() => createReglRenderer(canvasWith(fakeGl()))).toThrow(
      '(regl) Error compiling fragment shader, unknown'
    );
    expect(fake.control.instances.every((instance) => instance.destroyed)).toBe(true);
  });
});

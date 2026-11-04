import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulatorSession } from './simulatorSession';
import { MAX_LIVE_FOLDED_MESHES } from './simulatorLimits';
import type { Folded3dMeshPayload } from './foldedMeshSource';

const createSource = vi.hoisted(() => vi.fn());
vi.mock('./foldedMeshSource', () => ({
  FOLDED_3D_REQUIRED_DEPTH_BITS: 24,
  FoldedMeshSource: { create: createSource },
}));

class Canvas {
  static created: Canvas[] = [];
  stencil: boolean | undefined;
  readonly loseContext = vi.fn();
  constructor(public width: number, public height: number) {
    Canvas.created.push(this);
  }
  getContext(_kind: string, options?: { stencil?: boolean }) {
    // Match WebGL: the first request fixes the context attributes permanently.
    this.stencil ??= options?.stencil ?? false;
    return { getExtension: () => ({ loseContext: this.loseContext }) };
  }
}

const api = createSimulatorSession();
const bitmap = vi.fn(async (_canvas: Canvas, _x: number, _y: number, width: number, height: number) => ({
  width, height, close: vi.fn(),
}));
const payload = (spatial: boolean) => ({
  center: [0, 0, 0], radius: 1, ...(spatial ? { spatial: {} } : {}),
}) as Folded3dMeshPayload;
function load(spatial: boolean) {
  const result = api.loadFolded3dMesh(payload(spatial));
  if (!result) throw new Error('Expected a live mesh');
  return result.token;
}
const camera = (width: number) => ({ view: { yaw: 0, pitch: 0, zoom: 1 }, width, height: width });

beforeEach(() => {
  Canvas.created = [];
  vi.stubGlobal('OffscreenCanvas', Canvas);
  vi.stubGlobal('createImageBitmap', bitmap);
  bitmap.mockClear();
  createSource.mockReset().mockImplementation((canvas: Canvas, data: Folded3dMeshPayload) => {
    canvas.getContext('webgl2', { stencil: !!data.spatial });
    if (data.spatial && !canvas.stencil) throw new Error('Existing context cannot gain stencil');
    return {
      depthBits: 24,
      get drawingBufferSize() { return { width: canvas.width, height: canvas.height }; },
      render: vi.fn(), dispose: vi.fn(),
    };
  });
  // Start a new ordinary surface, including between tests of the module's API.
  api.attachCanvas(new Canvas(64, 64) as unknown as OffscreenCanvas);
  api.attachBitmapOutput(64, 64);
  Canvas.created = Canvas.created.slice(-1);
});
afterEach(() => {
  api.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('spatial rendering canvas isolation', () => {
  it.each([false, true])('isolates stencil regardless of load order (spatial first: %s)', async (spatialFirst) => {
    const first = load(spatialFirst), second = load(!spatialFirst);
    const ordinary = spatialFirst ? second : first;
    const spatial = spatialFirst ? first : second;
    const another = load(true);
    expect(Canvas.created).toHaveLength(2);
    const [normalCanvas, spatialCanvas] = Canvas.created;
    expect(normalCanvas!.stencil).toBe(false);
    expect(spatialCanvas!.stencil).toBe(true);
    await api.setFolded3dMeshCamera(ordinary, camera(256));
    expect(bitmap.mock.lastCall?.[0]).toBe(normalCanvas);
    await api.setFolded3dMeshCamera(spatial, camera(512));
    expect(bitmap.mock.lastCall?.[0]).toBe(spatialCanvas);
    api.releaseFolded3dMesh(spatial);
    expect(spatialCanvas!.loseContext).not.toHaveBeenCalled();
    api.releaseFolded3dMesh(another);
    expect(spatialCanvas!.loseContext).toHaveBeenCalledTimes(1);
    expect(normalCanvas!.loseContext).not.toHaveBeenCalled();
    await api.setFolded3dMeshCamera(ordinary, camera(256));
    expect(bitmap.mock.lastCall?.[0]).toBe(normalCanvas);
    const replacement = load(true);
    expect(Canvas.created).toHaveLength(3);
    await api.setFolded3dMeshCamera(replacement, camera(128));
    expect(bitmap.mock.lastCall?.[0]).toBe(Canvas.created[2]);
  });

  it('does not let an active large spatial view inflate the ordinary buffer', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const ordinary = load(false), spatial = load(true);
    await api.setFolded3dMeshCamera(ordinary, camera(1024));
    clock.mockReturnValue(900);
    await api.setFolded3dMeshCamera(spatial, camera(1600));
    clock.mockReturnValue(1000);
    await api.setFolded3dMeshCamera(ordinary, camera(256));
    expect(Canvas.created[0]!.width).toBe(256);
    expect(Canvas.created[1]!.width).toBeGreaterThanOrEqual(1600);
    expect(bitmap.mock.lastCall?.slice(3)).toEqual([256, 256]);
  });

  it.each(['null', 'throw'])('releases an unused spatial context when mesh creation fails (%s)', (failure) => {
    load(false);
    createSource.mockImplementationOnce((canvas: Canvas) => {
      canvas.getContext('webgl2', { stencil: true });
      if (failure === 'throw') throw new Error('Creation failed');
      return null;
    });
    if (failure === 'throw') expect(() => api.loadFolded3dMesh(payload(true))).toThrow('Creation failed');
    else expect(api.loadFolded3dMesh(payload(true))).toBeNull();
    expect(Canvas.created[1]!.loseContext).toHaveBeenCalledTimes(1);
    load(true);
    expect(Canvas.created).toHaveLength(3);
  });

  it('keeps other spatial meshes alive when a later mesh fails to load', async () => {
    const live = load(true);
    createSource.mockReturnValueOnce(null);
    expect(api.loadFolded3dMesh(payload(true))).toBeNull();
    expect(Canvas.created[1]!.loseContext).not.toHaveBeenCalled();
    await api.setFolded3dMeshCamera(live, camera(256));
    expect(bitmap.mock.lastCall?.[0]).toBe(Canvas.created[1]);
  });

  it('releases the spatial canvas when its last mesh is evicted by ordinary meshes', () => {
    load(true);
    for (let i = 0; i < MAX_LIVE_FOLDED_MESHES; i++) load(false);
    expect(Canvas.created).toHaveLength(2);
    expect(Canvas.created[1]!.loseContext).toHaveBeenCalledTimes(1);
    expect(Canvas.created[0]!.loseContext).not.toHaveBeenCalled();
  });
});

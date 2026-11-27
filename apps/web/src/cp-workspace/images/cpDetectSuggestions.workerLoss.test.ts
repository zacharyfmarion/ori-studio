// @vitest-environment jsdom
/**
 * ORI-STUDIO-1E, through the real detect runtime with only `Worker` faked.
 *
 * An image dropped on the Edit canvas is scored by the likelihood gate in the
 * detect worker. The worker fired a plain `error` event, the browser's word for
 * a worker whose script or an import did not load, and the user, who had only
 * placed a reference image, got "Ori Studio error: Crease-pattern detection
 * stopped unexpectedly" while Sentry got an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
const reportError = vi.fn();
vi.mock('../../analytics', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../monitoring', () => ({ reportError: (...args: unknown[]) => reportError(...args) }));
// A desktop-width Edit canvas in a build with the detector; the suggestion
// setting is on by default.
vi.mock('../../lib/workspaceCapabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/workspaceCapabilities')>()),
  cpDetectAvailableHere: () => true,
}));

/** A worker that never answers, which is what one that never ran does. */
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminated = false;
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
  }
  postMessage() {}
}

async function load() {
  vi.resetModules();
  const diagnostics = await import('../../lib/workerDiagnostics');
  const runtime = await import('../../store/workspaceStore/cpDetectRuntime');
  const suggestions = await import('./cpDetectSuggestions');
  // Stands in for the app's error toast, which App.tsx registers.
  const toast = vi.fn();
  diagnostics.registerWorkerFailureSink(toast);
  return { runtime, suggestions, toast };
}

const image = {
  id: 'image-1',
  preview: { width: 4, height: 4, data: new Uint8ClampedArray(64), colorSpace: 'srgb' } as ImageData,
  naturalWidth: 1200,
  naturalHeight: 900,
};

/** The worker's `error` arrives as a task of its own, after the call has been posted. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeWorker.instances = [];
  track.mockClear();
  reportError.mockClear();
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the gate on an added image, when the detect worker is lost', () => {
  it('says nothing when the worker never loaded, and counts it instead of reporting it', async () => {
    const { suggestions, toast } = await load();
    const scoring = suggestions.noteAddedCanvasImage(image);
    await nextTask();
    FakeWorker.instances[0].dispatchEvent(new Event('error'));
    await scoring;

    expect(toast).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('cp detect image score failed', { reason: 'unloaded' });
  });

  it('reports a worker that crashed under it, still without a toast', async () => {
    const { suggestions, toast } = await load();
    const scoring = suggestions.noteAddedCanvasImage(image);
    await nextTask();
    FakeWorker.instances[0].dispatchEvent(
      new ErrorEvent('error', { message: 'Uncaught RuntimeError: unreachable' })
    );
    await scoring;

    expect(toast).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      { code: 'cp_detect_client_lost', message: 'Uncaught RuntimeError: unreachable' },
      { surface: 'cp-detect-suggestion', handled: true }
    );
    expect(track).toHaveBeenCalledWith('cp detect image score failed', { reason: 'worker_lost' });
  });

  it('says nothing when the warm-up on a drag never loads', async () => {
    const { runtime, suggestions, toast } = await load();
    suggestions.warmCpDetectClient();
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    expect(toast).not.toHaveBeenCalled();
    expect(runtime.isCpDetectClientConnected()).toBe(false);
  });

  it('leaves the next Detect a fresh worker, whose loss is still shown', async () => {
    const { runtime, suggestions, toast } = await load();
    const scoring = suggestions.noteAddedCanvasImage(image);
    await nextTask();
    FakeWorker.instances[0].dispatchEvent(new Event('error'));
    await scoring;

    // What the import dialog does on Detect.
    await runtime.getCpDetectClient();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    const detect = runtime
      .whileCpDetectClientAlive(new Promise(() => {}))
      .catch((error: unknown) => error);
    FakeWorker.instances[1].dispatchEvent(new Event('error'));

    await expect(detect).resolves.toMatchObject({ code: 'cp_detect_client_lost', loadFailed: true });
    expect(toast).toHaveBeenCalledOnce();
  });
});

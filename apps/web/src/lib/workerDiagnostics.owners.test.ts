// @vitest-environment jsdom
/**
 * The owners of the app's workers, each held to the rule
 * `attachWorkerDiagnostics` keeps for them: a worker that threw is cancelled,
 * so the page does not report it a second time (ORI-STUDIO-1S), and reported
 * exactly once, as a `WorkerCrash`, because none of these owners reports a
 * crash itself. The two that do, the Fold and Layer order engines, are held to
 * one report, their own, in their runtimes' tests.
 *
 * Not here: the Box Pleating optimizer and the Defox import, whose workers are
 * spawned deep inside a run. They attach with no options, which is the path
 * every case below takes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerName } from './workerDiagnostics';

const reporting = vi.hoisted(() => ({ reportError: vi.fn() }));

vi.mock('../monitoring', () => ({ reportError: reporting.reportError }));

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

beforeEach(() => {
  FakeWorker.instances = [];
  reporting.reportError.mockClear();
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Start the owner's worker; whatever it hands back is settled or dropped by the test. */
type Spawn = () => Promise<unknown>;

const OWNERS: Array<[WorkerName, Spawn]> = [
  ['cp-detect', async () => (await import('../store/workspaceStore/cpDetectRuntime')).getCpDetectClient()],
  ['precrease', async () => (await import('../store/workspaceStore/precreaseRuntime')).retainPrecreaseClient()],
  ['simulator', async () => (await import('../store/workspaceStore/simulatorRuntime')).retainSimulatorClient()],
  ['treemaker', async () => (await import('../engines/engineHost')).connectEngine('treemaker')],
  ['oristudio-cp', async () => (await import('../engines/engineHost')).connectEngine('oristudio-cp')],
  ['oristudio-bp', async () => (await import('../engines/engineHost')).connectEngine('oristudio-bp')],
  ['cp-exact-solve', async () => (await import('../engine/cpExactSolveSession')).openCpExactSolveSession()],
  ['cp-task', async () => (await import('../engines/cpTaskSession')).createCpTaskSession()],
  [
    'reference-finder',
    async () => (await import('../store/workspaceStore/referenceFinderRuntime')).getReferenceFinderClient('window'),
  ],
  [
    'diagram-pdf',
    async () => {
      const { browserPdfWriter } = await import('../diagram/export/browserPdfWriter');
      // Rejects once the worker dies; the test only needs the worker started.
      void browserPdfWriter([], [], {} as never).catch(() => undefined);
    },
  ],
];

describe('every worker owner, when its worker throws', () => {
  it.each(OWNERS)('%s: cancelled, and reported once as a WorkerCrash', async (name, spawn) => {
    vi.resetModules();
    await spawn();
    const worker = FakeWorker.instances.at(-1);
    expect(worker).toBeDefined();

    const thrown = new ErrorEvent('error', {
      message: 'Uncaught RuntimeError: unreachable',
      filename: 'https://oristudio.test/assets/worker.js',
      lineno: 1,
      colno: 2,
      cancelable: true,
    });
    expect(worker!.dispatchEvent(thrown)).toBe(false);

    expect(reporting.reportError).toHaveBeenCalledOnce();
    expect(reporting.reportError.mock.calls[0]).toEqual([
      expect.objectContaining({ name: 'WorkerCrash', worker: name, message: `${name}: Uncaught RuntimeError: unreachable` }),
      { surface: `worker:${name}` },
    ]);
  });
});

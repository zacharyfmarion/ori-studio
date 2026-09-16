/**
 * The References query's lifecycle — the async edges, not the geometry.
 *
 * Every case here is a race the hook has to lose gracefully: the pick that is
 * dismissed while the frames worker is still answering, the workspace switch
 * mid-query, the planner worker dying between the answer and the mapping. None
 * of them are reachable from a pure function, and all three left the panel in a
 * state the user could not get out of, so the hook is mounted for real and the
 * two worker runtimes are the only things stubbed.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { ReferencesTargetController } from './useReferencesTarget';
import type { ReferencesHighlights, ReferencesViewState } from './useReferencesView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A promise plus the handles to settle it from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The rejection is always attached by the code under test; this keeps an
  // unhandled-rejection warning out of the log when a test never settles it.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

const stubs = vi.hoisted(() => {
  const state: {
    solve: { promise: Promise<unknown[]>; resolve: (v: unknown[]) => void; reject: (e: unknown) => void } | null;
    frames: { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } | null;
    mapping: { promise: Promise<Float64Array>; resolve: (v: Float64Array) => void; reject: (e: unknown) => void } | null;
    released: number;
    reported: unknown[];
    framesCalls: number;
  } = { solve: null, frames: null, mapping: null, released: 0, reported: [], framesCalls: 0 };
  return state;
});

vi.mock('../../monitoring', () => ({
  reportError: (error: unknown) => {
    stubs.reported.push(error);
  },
}));

vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  DURATION_MS_BUCKETS: [1000],
  bucketCount: () => '0',
  track: () => undefined,
}));

vi.mock('../../store/workspaceStore/referenceFinderRuntime', () => ({
  getReferenceFinderClient: () => ({
    instance: 'window',
    key: 'k',
    settings: {},
    ready: () => Promise.resolve({}),
    solvePoint: () => stubs.solve!.promise,
    solveLine: () => stubs.solve!.promise,
  }),
  whileReferenceFinderClientAlive: <T,>(_instance: string, _key: string, pending: Promise<T>) => pending,
  releaseReferenceFinderClient: () => {
    stubs.released += 1;
    // The real runtime rejects every in-flight call before terminating, with an
    // envelope that does not say why — which is the whole reason the panel needs
    // its own "I am leaving" signal.
    stubs.solve?.reject({
      code: 'reference_finder_client_lost',
      message: 'The reference finder was released while it was running.',
    });
  },
}));

vi.mock('../../store/workspaceStore/precreaseRuntime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../store/workspaceStore/precreaseRuntime')>();
  return {
    ...actual,
    getPrecreaseClient: () => ({
      sheetFrames: () => {
        stubs.framesCalls += 1;
        return stubs.frames!.promise;
      },
      modelToRf: () => Promise.resolve([0.5, 0.5]),
      rfToModelMany: () => stubs.mapping!.promise,
    }),
  };
});

const { useReferencesTarget } = await import('./useReferencesTarget');
const { useReferencesHighlights } = await import('./useReferencesView');
const { referencesRunSnapshot, resetReferencesRun } = await import('./referencesRun');
const { clearReferencesResults, referencesResultsSnapshot } = await import('./referencesResults');
const { releasePrecreaseClient } = await import('../../store/workspaceStore/precreaseRuntime');
const { useWorkspaceStore } = await import('../../store/workspaceStore');

/** jsdom has no Worker; the precrease runtime spawns a real one on retain. */
class FakeWorker extends EventTarget {
  terminate() {}
  postMessage() {}
}

/** Two creases round a corner of a unit-ish sheet; only the endpoints matter here. */
const GEOMETRY = {
  segEndpoints: Float64Array.from([0, 0, 100, 0, 0, 0, 0, 100]),
  segAttr: new Int32Array(10),
} as unknown as CpGeometryTransport;

/** A single square sheet owning both segments — what `sheetFrames` would answer. */
const ANALYSIS = {
  components: [
    {
      id: 0,
      frame: { origin: [0, 0], x_axis: [1, 0], y_axis: [0, -1], width: 100, height: 100 },
      rf_rect: { width: 1, height: 1 },
      affines: null,
      outline: [],
      outline_residual: 0,
      is_fallback: false,
      border_segment_indices: [],
      segment_indices: [0, 1],
      unit_segments: [],
      merged_lines: [],
      exactness: null,
      refused: null,
    },
  ],
  unassigned_segments: [],
  warnings: [],
  segment_count: 2,
  tol: 1e-6,
  snap_radius: 2e-3,
};

function viewState(revision = 'r1'): ReferencesViewState {
  return {
    hasDocument: true,
    geometry: GEOMETRY,
    revision,
    framingKey: 'load-1',
    lineStyle: 'color',
    mode: 'mvf',
    lineWidth: 1,
    pointSize: 1,
    wheelGesture: 'zoom',
    snapRadius: 4,
    themeKey: 'light',
  } as ReferencesViewState;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let controller: ReferencesTargetController | null = null;
let highlights: ReferencesHighlights | null = null;

/** The panel's own wiring: the controller feeding the canvas's highlight props. */
function Harness({ view }: { view: ReferencesViewState }) {
  const value = useReferencesTarget(view);
  const drawn = useReferencesHighlights(
    view.geometry,
    value.results,
    !value.stale,
    value.picked,
    value.activeCandidate,
    value.activeStep
  );
  // Captured in an effect, not during render: `act` flushes effects before it
  // returns, so both are current by the time a test reads them.
  useEffect(() => {
    controller = value;
    highlights = drawn;
  });
  return null;
}

function mount(view = viewState()): void {
  act(() => root?.render(<Harness view={view} />));
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  resetReferencesRun();
  clearReferencesResults();
  useWorkspaceStore.getState().setReferencesTarget(null);
  useWorkspaceStore.getState().setReferencesCandidates(null);
  useWorkspaceStore.getState().setReferencesRun({ status: 'idle' });
  stubs.solve = deferred<unknown[]>();
  stubs.frames = deferred<unknown>();
  stubs.mapping = deferred<Float64Array>();
  stubs.released = 0;
  stubs.reported = [];
  stubs.framesCalls = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  controller = null;
  highlights = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Let queued microtasks run. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useReferencesTarget: the pick before the answer', () => {
  it('publishes the picked crease before the query answers', async () => {
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    act(() => controller!.pick({ kind: 'line', id: 1 }));
    await settle();

    // Still waiting on ReferenceFinder: no results at all…
    expect(referencesResultsSnapshot().results).toBeNull();
    // …but the canvas already knows what was clicked.
    expect(controller!.picked).toMatchObject({ kind: 'crease', lineId: 1 });
    expect(highlights!.selected).toEqual({ kind: 'line', id: 1 });
  });

  it('keeps marking the pick after the query fails', async () => {
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    act(() => controller!.pick({ kind: 'line', id: 1 }));
    await settle();
    act(() => stubs.solve!.reject({ code: 'reference_finder', message: 'boom' }));
    await settle();

    expect(useWorkspaceStore.getState().referencesRun.status).toBe('error');
    // The toolbar meta says "Crease"; the canvas must not disagree with it.
    expect(controller!.picked).toMatchObject({ kind: 'crease', lineId: 1 });
    expect(highlights!.selected).toEqual({ kind: 'line', id: 1 });
  });

  it('forgets the pick once the geometry it was made on is gone', async () => {
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    act(() => controller!.pick({ kind: 'line', id: 1 }));
    await settle();
    expect(controller!.picked).not.toBeNull();

    // An edit: a pending pick for r1 must not mark whatever crease now sits at
    // that index in r2.
    stubs.frames = deferred();
    mount(viewState('r2'));
    await settle();
    expect(controller!.picked).toBeNull();
    expect(highlights!.selected).toBeNull();
  });
});

describe('useReferencesTarget: dismissing a pick', () => {
  it('does not resurrect a pick dismissed while the frames were still resolving', async () => {
    // The reachable window: `query()` awaits `framesFor` and `resolve` with the
    // run registry still idle and no overlay over the canvas, so a click on
    // empty space really does land here.
    mount();
    act(() => controller!.pick({ kind: 'line', id: 1 }));
    act(() => controller!.pick(null));
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();

    expect(useWorkspaceStore.getState().referencesTarget).toBeNull();
    expect(referencesResultsSnapshot().pending).toBeNull();
    expect(controller!.picked).toBeNull();
    expect(highlights!.selected).toBeNull();
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('idle');
  });

  it('drops the answer to a query whose pick was dismissed', async () => {
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    act(() => controller!.pick({ kind: 'line', id: 1 }));
    await settle();
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('running');

    act(() => controller!.pick(null));
    act(() => stubs.solve!.resolve([]));
    act(() => stubs.mapping!.resolve(Float64Array.from(new Array(32).fill(0))));
    await settle();

    expect(referencesResultsSnapshot().results).toBeNull();
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('idle');
    expect(referencesRunSnapshot().running).toBe(false);
  });
});

describe('useReferencesTarget: leaving the workspace', () => {
  it('treats the unmount release as a cancellation, not a failure', async () => {
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    act(() => controller!.pick({ kind: 'line', id: 1 }));
    await settle();

    // Switching to Edit clears the dock, which unmounts the panel and releases
    // the ReferenceFinder worker out from under the query.
    act(() => root?.unmount());
    await settle();

    expect(stubs.released).toBeGreaterThan(0);
    expect(stubs.reported).toEqual([]);
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('idle');
    expect(referencesRunSnapshot().running).toBe(false);
  });
});

describe('useReferencesTarget: a planner worker that dies mid-mapping', () => {
  it('ends the run instead of leaving it running forever', async () => {
    // `terminate()` orphans comlink's in-flight promises — they never settle —
    // so this await is the one place a run could latch on `{status:'running'}`
    // with Stop and Recompute both dead. A `finally` cannot help; the liveness
    // race is what ends it.
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    act(() => controller!.pick({ kind: 'line', id: 1 }));
    await settle();
    act(() => stubs.solve!.resolve([]));
    await settle();
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('running');

    // The worker crashes; `stubs.mapping` is never settled, exactly as comlink
    // would leave it.
    act(() => releasePrecreaseClient());
    await settle();

    expect(referencesRunSnapshot().running).toBe(false);
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('error');
  });
});

describe('useReferencesTarget: the frames effect', () => {
  it('does not re-ask the planner for a fresh transport with the same creases', async () => {
    // Every kernel command hands back a new transport object, selection-only
    // ones included. Keyed on that identity, a box-select cost a worker round
    // trip and rewrote the frames record.
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    expect(stubs.framesCalls).toBe(1);

    const sameContent = {
      ...viewState('r1'),
      geometry: { ...GEOMETRY } as unknown as CpGeometryTransport,
    };
    mount(sameContent);
    await settle();
    expect(stubs.framesCalls).toBe(1);
  });
});

describe('useReferencesTarget: a setting that shapes the answer', () => {
  afterEach(() => {
    useWorkspaceStore.getState().setReferencesSettings({ includeApproximate: false, candidateCount: 5 });
  });

  it('asks again about the picked target when approximate answers are switched on', async () => {
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    act(() => controller!.pick({ kind: 'line', id: 1 }));
    await settle();
    act(() => stubs.solve!.resolve([]));
    act(() => stubs.mapping!.resolve(Float64Array.from(new Array(32).fill(0))));
    await settle();
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('idle');
    expect(referencesResultsSnapshot().results).not.toBeNull();

    // The toggle: a fresh query for the same crease, with the new settings.
    stubs.solve = deferred<unknown[]>();
    stubs.mapping = deferred<Float64Array>();
    act(() => useWorkspaceStore.getState().setReferencesSettings({ includeApproximate: true }));
    await settle();
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('running');
    expect(referencesResultsSnapshot().pending).toMatchObject({ record: { kind: 'crease', lineId: 1 } });
  });

  it('does nothing with nothing picked, and nothing on mount', async () => {
    useWorkspaceStore.getState().setReferencesSettings({ includeApproximate: true });
    mount();
    act(() => stubs.frames!.resolve(ANALYSIS));
    await settle();
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('idle');

    act(() => useWorkspaceStore.getState().setReferencesSettings({ candidateCount: 10 }));
    await settle();
    expect(useWorkspaceStore.getState().referencesRun.status).toBe('idle');
    expect(referencesResultsSnapshot().pending).toBeNull();
  });
});

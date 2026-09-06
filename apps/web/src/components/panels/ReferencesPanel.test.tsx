/**
 * The panel's hook order, across every branch it switches on.
 *
 * `ReferencesPanel` is a composition site over eleven custom hooks in six
 * modules, and it renders two different modes (a ReferenceFinder target, or the
 * whole-pattern breakdown) plus four overlay states from one hook list. Nothing
 * else in the suite mounts it, so a hook that lands behind one of those branches
 * — a store subscription read only when there is a document, an effect only for
 * a picked target — would reach the browser as "React has detected a change in
 * the order of Hooks called by ReferencesPanel" and take the panel into its
 * error boundary.
 *
 * React throws on a hook-order change, so this is a loud test: one mount is
 * driven through every transition, and any conditional hook fails it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../monitoring', () => ({ reportError: () => undefined }));

vi.mock('../../store/workspaceStore/referenceFinderRuntime', () => ({
  getReferenceFinderClient: () => ({
    instance: 'window',
    key: 'k',
    settings: {},
    ready: () => Promise.resolve({}),
    solvePoint: () => new Promise(() => undefined),
    solveLine: () => new Promise(() => undefined),
  }),
  whileReferenceFinderClientAlive: <T,>(_instance: string, _key: string, pending: Promise<T>) =>
    pending,
  releaseReferenceFinderClient: () => undefined,
}));

// The two worker runtimes are the only things stubbed; every call is left
// pending so the panel stays in the state each transition puts it in.
vi.mock('../../store/workspaceStore/precreaseRuntime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../store/workspaceStore/precreaseRuntime')>();
  return {
    ...actual,
    retainPrecreaseClient: () => undefined,
    releasePrecreaseClient: () => undefined,
    peekPrecreaseClient: () => null,
    getPrecreaseClient: () => ({
      sheetFrames: () => new Promise(() => undefined),
      modelToRf: () => Promise.resolve([0.5, 0.5]),
      rfToModelMany: () => new Promise(() => undefined),
    }),
  };
});

// The canvas is a WebGL surface with hooks of its own, and a child's hook list
// is its own; what is under test is the panel's.
vi.mock('../../cp-workspace/references/ReferencesCpView', () => ({
  ReferencesCpView: () => null,
}));

const { ReferencesPanel } = await import('./ReferencesPanel');
const { TooltipProvider } = await import('../ui/Tooltip');
const { useWorkspaceStore } = await import('../../store/workspaceStore');
const { clearReferencesResults } = await import('../../cp-workspace/references/referencesResults');
const { resetReferencesRun } = await import('../../cp-workspace/references/referencesRun');

/** jsdom has no Worker; the precrease runtime spawns a real one on retain. */
class FakeWorker extends EventTarget {
  terminate() {}
  postMessage() {}
}

const GEOMETRY = {
  segEndpoints: Float64Array.from([0, 0, 100, 0, 0, 0, 0, 100]),
  segAttr: new Int32Array(10),
} as unknown as CpGeometryTransport;

/** Only the fields the References binding reads. */
function cpDocument(loadSerial: number) {
  return {
    handle: 1,
    loadSerial,
    document: { crease_pattern: { line_segments: [] }, metadata: {} },
    geometry: GEOMETRY,
    summary: {},
    source: { format: 'cp', filename: 'x.cp', path: null },
    operationDescriptors: [],
    lastCommandResult: null,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  resetReferencesRun();
  clearReferencesResults();
  useWorkspaceStore.setState({ oristudioCpDocument: null } as never);
  useWorkspaceStore.getState().setReferencesTarget(null);
  useWorkspaceStore.getState().setReferencesCandidates(null);
  useWorkspaceStore.getState().setReferencesRun({ status: 'idle' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useWorkspaceStore.setState({ oristudioCpDocument: null } as never);
  useWorkspaceStore.getState().setReferencesTarget(null);
  useWorkspaceStore.getState().setReferencesCandidates(null);
  useWorkspaceStore.getState().setReferencesRun({ status: 'idle' });
  vi.unstubAllGlobals();
});

it('holds its hook order through every mode and run state', () => {
  act(() =>
    root?.render(
      <TooltipProvider>
        <ReferencesPanel />
      </TooltipProvider>
    )
  );
  // Empty: no document, so the panel is the "No crease pattern" overlay.
  expect(container?.querySelector('.references-panel__overlay')).not.toBeNull();

  const store = () => useWorkspaceStore.getState();
  const transitions: Array<() => void> = [
    // A pattern arrives: geometry, revision and `hasDocument` all flip.
    () => useWorkspaceStore.setState({ oristudioCpDocument: cpDocument(1) } as never),
    () => store().setReferencesRun({ status: 'running', startedAt: Date.now() }),
    // A pick switches the panel from the breakdown to the target mode.
    () =>
      store().setReferencesTarget({
        kind: 'crease',
        component: 0,
        lineId: 1,
        a: { x: 0, y: 0 },
        b: { x: 100, y: 0 },
        cpLineIds: [1],
      } as never),
    () => store().setReferencesCandidates([{ rank: 0, foldCount: 1, stepCount: 1, err: 0, exact: true }] as never),
    () => store().setReferencesRun({ status: 'error', message: 'nope' }),
    () => store().setReferencesRun({ status: 'stale' }),
    () => store().setReferencesRun({ status: 'idle' }),
    // ...and back to the breakdown mode.
    () => store().setReferencesTarget(null),
    () => useWorkspaceStore.setState({ oristudioCpDocument: cpDocument(2) } as never),
    () => useWorkspaceStore.setState({ oristudioCpDocument: null } as never),
  ];

  for (const drive of transitions) {
    act(drive);
    // Still the panel, not the error boundary's fallback.
    expect(container?.querySelector('.references-workspace')).not.toBeNull();
  }
});

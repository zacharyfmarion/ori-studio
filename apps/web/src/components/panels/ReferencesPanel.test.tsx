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
      // Reached only once the frames are known and the sequence is asked for
      // (the mode test switches to it); it then stays running.
      plannerCreate: () => new Promise(() => undefined),
      plannerDispose: () => Promise.resolve(),
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
const { PHONE_MEDIA_QUERY } = await import('../../platform/phoneLayout');
const { useWorkspaceStore } = await import('../../store/workspaceStore');
const { useLayoutStore } = await import('../../store/layoutStore');
const { clearReferencesResults, setReferencesFrames } = await import(
  '../../cp-workspace/references/referencesResults'
);
const { resetReferencesRun } = await import('../../cp-workspace/references/referencesRun');
const { referencesRevisionKey } = await import('../../cp-workspace/references/useReferencesView');

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

/** One square sheet owning both segments — what `sheetFrames` would answer. */
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
    // ...and back to Find with nothing picked.
    () => store().setReferencesTarget(null),
    // The sequence: planned on switching to it, read once a plan is there.
    () => store().setReferencesView({ mode: 'sequence' }),
    () => store().setReferencesRun({ status: 'running', startedAt: Date.now() }),
    () => store().setReferencesRun({ status: 'idle' }),
    () => store().setReferencesView({ mode: 'find' }),
    () => useWorkspaceStore.setState({ oristudioCpDocument: cpDocument(2) } as never),
    () => useWorkspaceStore.setState({ oristudioCpDocument: null } as never),
  ];

  for (const drive of transitions) {
    act(drive);
    // Still the panel, not the error boundary's fallback.
    expect(container?.querySelector('.references-workspace')).not.toBeNull();
  }
});

it('keeps the header to the title and floats the view verbs over the canvas', () => {
  // The zoom buttons, the settings popover and Recompute used to fill the
  // header's right end. The settings are the View pane now (its own dock
  // panel), and the verbs are the Edit workspace's bar, mounted only once
  // there is a pattern to look at.
  act(() =>
    root?.render(
      <TooltipProvider>
        <ReferencesPanel />
      </TooltipProvider>
    )
  );
  const query = (selector: string) => container?.querySelector(selector) ?? null;
  expect(query('.viewport-toolbar')).toBeNull();

  act(() => useWorkspaceStore.setState({ oristudioCpDocument: cpDocument(1) } as never));

  const header = query('.references-panel .panel-toolbar');
  // No title: the header is the mode switch, two tabs drawn as the Design
  // workspace draws its designs' tabs.
  expect(header?.querySelector('.panel-title')).toBeNull();
  expect(
    [...(header?.querySelectorAll('button') ?? [])].map(
      (button) => `${button.getAttribute('role')}:${button.textContent}`
    )
  ).toEqual(['tab:Find a reference', 'tab:Precreasing sequence']);
  expect(header?.querySelector('.design-tab-strip [role="tablist"]')).not.toBeNull();
  const bar = query('.references-panel__body .viewport-toolbar');
  expect(
    [...(bar?.querySelectorAll('button') ?? [])].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent
    )
  ).toEqual(['Zoom Out', '100%', 'Zoom In', 'Fit', 'Recompute References']);
});

it('lands in Find with the lead where the filmstrip goes, and plans only when the sequence is asked for', () => {
  act(() =>
    root?.render(
      <TooltipProvider>
        <ReferencesPanel />
      </TooltipProvider>
    )
  );
  const query = (selector: string) => container?.querySelector(selector) ?? null;
  const document1 = cpDocument(1);
  act(() => {
    setReferencesFrames({
      revision: referencesRevisionKey(document1 as never),
      analysis: ANALYSIS as never,
    });
    useWorkspaceStore.setState({ oristudioCpDocument: document1 } as never);
  });
  // Find: the hint naming both jobs, no strip, and nothing running.
  expect(useWorkspaceStore.getState().referencesView.mode).toBe('find');
  expect(query('.references-lead')?.textContent).toContain('Tap a vertex or crease');
  expect(query('.references-lead__link')?.textContent).toContain('plan the whole precreasing');
  expect(query('.references-filmstrip')).toBeNull();
  expect(useWorkspaceStore.getState().referencesRun.status).toBe('idle');

  // The lead's own link is a way into the sequence…
  act(() =>
    query('.references-lead__link')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  );
  expect(useWorkspaceStore.getState().referencesView.mode).toBe('sequence');
  // …and back to Find by the tab. (Radix activates a tab on mousedown, not click.)
  act(() =>
    query('.references-mode [role="tab"][aria-selected="false"]')?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    )
  );
  expect(useWorkspaceStore.getState().referencesView.mode).toBe('find');
  // Sequence by the tab: the planner is asked, and the lead says so.
  act(() =>
    query('.references-mode [role="tab"][aria-selected="false"]')?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    )
  );
  expect(useWorkspaceStore.getState().referencesView.mode).toBe('sequence');
  expect(useWorkspaceStore.getState().referencesRun.status).toBe('running');
  expect(query('.references-lead')?.textContent).toContain('Working out the precreasing sequence');
  expect(query('.references-filmstrip')).toBeNull();

  // A new document lands in Find again.
  act(() => useWorkspaceStore.setState({ oristudioCpDocument: cpDocument(2) } as never));
  expect(useWorkspaceStore.getState().referencesView.mode).toBe('find');
});

it('says a sheet with no creases has nothing to find, and disables the switch', () => {
  act(() =>
    root?.render(
      <TooltipProvider>
        <ReferencesPanel />
      </TooltipProvider>
    )
  );
  const query = (selector: string) => container?.querySelector(selector) ?? null;
  const document1 = cpDocument(1);
  act(() => {
    setReferencesFrames({
      revision: referencesRevisionKey(document1 as never),
      analysis: {
        ...ANALYSIS,
        components: [{ ...ANALYSIS.components[0], segment_indices: [], border_segment_indices: [0, 1] }],
      } as never,
    });
    useWorkspaceStore.setState({ oristudioCpDocument: document1 } as never);
  });
  expect(query('.references-panel__overlay')?.textContent).toContain('No creases yet');
  expect(query('.references-lead')).toBeNull();
  expect(query('.references-mode [role="tab"]')?.hasAttribute('disabled')).toBe(true);
  expect(useWorkspaceStore.getState().referencesRun.status).toBe('idle');
});

it('offers the touch drawer a slot at the top right of its view', () => {
  // The shell's pill lane sits over the dock's top-right corner, which here is
  // the header and the filmstrip. The panel knows where its view begins, so it
  // registers a slot there and takes it back when it goes.
  act(() =>
    root?.render(
      <TooltipProvider>
        <ReferencesPanel />
      </TooltipProvider>
    )
  );
  const slot = container?.querySelector('.references-panel__body .references-panel__pills');
  expect(slot).not.toBeNull();
  expect(useLayoutStore.getState().viewDrawerSlot).toBe(slot);

  act(() => root?.render(<div />));

  expect(useLayoutStore.getState().viewDrawerSlot).toBeNull();
});

/**
 * The phone branch: one screen at a time, swapped by a press and a Back.
 *
 * The frames are seeded rather than answered by the (pending) worker stub, so
 * the list has a card to press; the detail opens in Find, with nothing
 * running.
 */
it('on a phone, opens a sheet from the list into the detail and comes back', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
  act(() =>
    root?.render(
      <TooltipProvider>
        <ReferencesPanel />
      </TooltipProvider>
    )
  );
  const query = (selector: string) => container?.querySelector(selector) ?? null;
  const press = (selector: string) =>
    act(() => query(selector)?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  // No document: the detail's empty overlay is the screen, and it has no Back.
  expect(query('.references-sidebar')).toBeNull();
  expect(query('.references-panel__overlay')).not.toBeNull();
  expect(query('.references-panel__back')).toBeNull();

  const document1 = cpDocument(1);
  act(() => {
    setReferencesFrames({
      revision: referencesRevisionKey(document1 as never),
      analysis: ANALYSIS as never,
    });
    useWorkspaceStore.setState({ oristudioCpDocument: document1 } as never);
  });
  // A document: the list, alone, with its one card.
  expect(query('.references-panel')).toBeNull();
  expect(container?.querySelectorAll('.references-sheet')).toHaveLength(1);

  press('.references-sheet');
  // The detail, alone, with the way back where the title was.
  expect(query('.references-sidebar')).toBeNull();
  expect(query('.references-panel')).not.toBeNull();
  expect(query('.references-panel__back')).not.toBeNull();
  expect(query('.panel-title')).toBeNull();

  press('.references-panel__back');
  expect(query('.references-sidebar')).not.toBeNull();
  expect(query('.references-panel')).toBeNull();

  // Open again, then a new document arrives under the detail: back to the list.
  press('.references-sheet');
  expect(query('.references-panel')).not.toBeNull();
  act(() => useWorkspaceStore.setState({ oristudioCpDocument: cpDocument(2) } as never));
  expect(query('.references-sidebar')).not.toBeNull();
  expect(query('.references-panel')).toBeNull();
});

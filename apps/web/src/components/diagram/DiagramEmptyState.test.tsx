import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIAGRAM_TUTORIAL_URL } from '../../diagram/example/diagramExample';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { CommandDialogModal } from '../CommandDialogModal';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramEmptyState } from './DiagramEmptyState';

/**
 * The empty Diagram's ways to learn: the example crane, opened through the
 * store's own `openProject` — its unsaved-changes prompt included — and the
 * video walkthrough.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({
  trackDiagramExampleOpened: vi.fn(),
  trackDiagramTutorialOpened: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

vi.mock('../../routing/workspaceUrlSync', () => ({ showActiveWorkspace: vi.fn() }));

/** A project that is one diagram of one step: what the open reads, without an engine to start. */
const EXAMPLE = JSON.stringify({
  format: 'oristudio.project',
  schemaVersion: 8,
  minimumReaderSchemaVersion: 10,
  createdBy: { app: 'Ori Studio', version: '0.6.0', savedAt: '2026-10-16T00:00:00.000Z' },
  modifiedBy: { app: 'Ori Studio', version: '0.6.0', savedAt: '2026-10-16T00:00:00.000Z' },
  workspace: {
    id: 'workspace',
    title: 'Crane',
    activeDocumentId: 'crease-pattern',
    designs: [],
    creasePattern: null,
    unknownDesigns: [],
    diagrams: [
      {
        formatVersion: 1,
        id: 'diagram-example',
        title: 'Crane',
        steps: [{ id: 'step-1', revision: 1, annotations: [], text: 'Fold in half' }],
        assets: {},
      },
    ],
    viewState: {},
  },
  artifacts: {},
  extensions: {},
});

const workspaceInitial = useWorkspaceStore.getInitialState();
const layoutInitial = useLayoutStore.getInitialState();
const fetchMock = vi.fn<typeof fetch>();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => new Response(EXAMPLE, { status: 200 }));
  useWorkspaceStore.setState(workspaceInitial, true);
  // As in the app once its engine is up: File › Open is refused until then.
  useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
  useLayoutStore.setState(layoutInitial, true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const noop = () => {};
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramEmptyState
          readOnly={false}
          dropTarget={false}
          onAddStep={noop}
          onUpload={noop}
          patternOpen={false}
          onLink={noop}
          onFromReferences={noop}
          onGoToEdit={noop}
        />
        <CommandDialogModal />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

const state = () => useWorkspaceStore.getState();
const buttonNamed = (name: string, within: ParentNode | null = host) =>
  [...(within?.querySelectorAll('button') ?? [])].find((button) => button.textContent === name) as
    | HTMLButtonElement
    | undefined;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

/** Let the download, the prompt and the load each take their turn. */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('DiagramEmptyState: the example and the walkthrough', () => {
  it('opens the example as a file, landing on its diagram', async () => {
    act(() => buttonNamed('Open the example crane')?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledWith('/examples/Crane.osf');
    expect(dialog()).toBeNull();
    expect(state().diagram?.title).toBe('Crane');
    expect(state().diagram?.steps).toHaveLength(1);
    expect(state().currentFileName).toBe('Crane.osf');
    expect(useLayoutStore.getState().activeWorkspace).toBe('diagram');
    expect(analytics.trackDiagramExampleOpened).toHaveBeenCalledWith('opened');
  });

  it('asks before replacing unsaved work, and keeps it when the answer is no', async () => {
    useWorkspaceStore.setState({ dirty: true, currentFileName: 'mine.osf' });

    act(() => buttonNamed('Open the example crane')?.click());
    await settle();

    expect(dialog()?.textContent).toContain('Discard unsaved changes?');
    // Still under way while the question is up.
    expect(buttonNamed('Opening the example…')?.disabled).toBe(true);

    act(() => buttonNamed('Cancel', dialog())?.click());
    await settle();

    expect(dialog()).toBeNull();
    expect(state()).toMatchObject({ dirty: true, currentFileName: 'mine.osf', diagram: null });
    expect(analytics.trackDiagramExampleOpened).toHaveBeenCalledWith('cancelled');
    expect(buttonNamed('Open the example crane')?.disabled).toBe(false);
  });

  it('replaces unsaved work once the user says to discard it', async () => {
    useWorkspaceStore.setState({ dirty: true, currentFileName: 'mine.osf' });

    act(() => buttonNamed('Open the example crane')?.click());
    await settle();
    act(() => buttonNamed('Discard', dialog())?.click());
    await settle();

    expect(state()).toMatchObject({ dirty: false, currentFileName: 'Crane.osf' });
    expect(state().diagram?.title).toBe('Crane');
    expect(analytics.trackDiagramExampleOpened).toHaveBeenCalledWith('opened');
  });

  it('says so when the example cannot be downloaded', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    act(() => buttonNamed('Open the example crane')?.click());
    await settle();

    expect(dialog()).toBeNull();
    expect(state().error?.message).toBe(
      "Couldn't download the example crane. Check your connection and try again."
    );
    expect(state().diagram).toBeNull();
    expect(analytics.trackDiagramExampleOpened).toHaveBeenCalledWith('unavailable');
  });

  it('links the walkthrough, opening outside the app', () => {
    const link = [...(host?.querySelectorAll('a') ?? [])].find(
      (anchor) => anchor.textContent === 'Watch the walkthrough'
    );

    expect(link?.getAttribute('href')).toBe('https://www.youtube.com/watch?v=OMLFtb368is');
    expect(DIAGRAM_TUTORIAL_URL).toBe('https://www.youtube.com/watch?v=OMLFtb368is');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));

    // jsdom would try to navigate; the browser opens a tab.
    link?.addEventListener('click', (event) => event.preventDefault());
    act(() => link?.click());
    expect(analytics.trackDiagramTutorialOpened).toHaveBeenCalledOnce();
  });
});

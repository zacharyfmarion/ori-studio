import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { foldedFigureGesture } from './foldedFigureGesture';
import { pendingFoldedModelWrites, resetFoldedModelWriteQueueForTests } from './foldedModelWriteQueue';
import { useFoldedFigures } from './useFoldedFigures';

/**
 * The selection toolbar's two fold verbs and Fold with layer order…'s key, as
 * the panel binds them (`useFoldedFigures`): a Style-menu colour run still
 * open lands as its own entry first, as it does for G, rather than holding the
 * folded layer against the fold (the bracket refuses a second owner).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIGURE_ID = 'folded-1';

const MODEL: OristudioCpFoldedFigureModel = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

function figure(id = FIGURE_ID): OristudioCpFoldedFigureEntry {
  return {
    id,
    title: id,
    handle: 7,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: { model: MODEL },
    renderSnapshot: null,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
  } as OristudioCpFoldedFigureEntry;
}

type Api = ReturnType<typeof useFoldedFigures>;
const api: { current: Api | null } = { current: null };

function Probe({ selected }: { selected: number[] }): null {
  const folded = useFoldedFigures({ cpDocument: null, selectedFoldLineIds: selected });
  useEffect(() => {
    api.current = folded;
  });
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const realFold = useWorkspaceStore.getState().foldOristudioCpDocument;
const realPrepare = useWorkspaceStore.getState().prepareOristudioCpLayerOrderFold;
const realUpdate = useWorkspaceStore.getState().updateOristudioCpFoldedFigureModel;

/**
 * A colour drag on the figure's Style menu, still open: the folded layer's
 * bracket held under its scope, its kernel write answered (a write still in
 * flight holds every verb back until it lands, G's included).
 */
async function openColourRun() {
  act(() =>
    api.current!.actionDeps.setAppearance!(
      figure(),
      { field: 'paper.front', value: '#ff0000' },
      { scope: `folded-color:${FIGURE_ID}:paper.front`, label: 'Change folded model color' }
    )
  );
  await vi.waitFor(() => expect(pendingFoldedModelWrites()).toBeNull());
  expect(foldedFigureGesture.begin('verb')).toBeNull();
}

const labels = () => useWorkspaceStore.getState().oristudioCpHistoryPast.map((entry) => entry.label);

beforeEach(() => {
  resetFoldedModelWriteQueueForTests();
  foldedFigureGesture.abortAll();
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: { document: {}, summary: null } as unknown as OristudioCpDocumentState,
    oristudioCpFoldedFigures: [figure()],
    oristudioCpActiveFoldedFigureId: FIGURE_ID,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    dirty: false,
    // The kernel's model write, answered at once: the paper-style mirror writes the pinned colour through it.
    updateOristudioCpFoldedFigureModel: vi.fn(async () => true),
    // A fold that lands a figure; the real one needs the fold engine.
    foldOristudioCpDocument: vi.fn(async () => {
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: [...useWorkspaceStore.getState().oristudioCpFoldedFigures, figure('folded-2')],
      });
      return true;
    }),
    prepareOristudioCpLayerOrderFold: vi.fn(async () => ({ status: 'unavailable', reason: 'cancelled' }) as const),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe selected={[1, 2]} />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  useWorkspaceStore.setState({
    foldOristudioCpDocument: realFold,
    prepareOristudioCpLayerOrderFold: realPrepare,
    updateOristudioCpFoldedFigureModel: realUpdate,
  });
  resetFoldedModelWriteQueueForTests();
  foldedFigureGesture.abortAll();
});

describe('a fold after a Style-menu colour run left open', () => {
  it('the toolbar’s Fold lands the run as its own entry, then folds as one', async () => {
    await openColourRun();
    await act(async () => api.current!.foldLines([1, 2]));
    await vi.waitFor(() => expect(labels()).toEqual(['Change folded model color', 'Fold model']));
  });

  it.each([
    ['the toolbar’s Fold with layer order…', () => api.current!.foldLinesWithLayerOrder([1, 2])],
    ['its key, on the selection', () => api.current!.foldModelWithLayerOrder()],
  ])('%s lands the run first, and the press goes ahead', async (_name, press) => {
    await openColourRun();
    await act(async () => press());
    await vi.waitFor(() => expect(useWorkspaceStore.getState().prepareOristudioCpLayerOrderFold).toHaveBeenCalledWith([1, 2]));
    await vi.waitFor(() => expect(labels()).toEqual(['Change folded model color']));
  });
});

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import { useFoldedFigures } from './useFoldedFigures';

/**
 * The gesture bracket, and the undo entry it owes.
 *
 * `runFoldedFigureAction` snapshots, acts, and records in a `finally` — which is
 * right for a verb that succeeds and wrong for one that does not. A fold that is
 * refused, fails, or is **stopped** ran the same bracket and put the list back
 * exactly as it found it, so the entry it recorded undid nothing while marking
 * the project dirty. Cancellation makes that the routine case rather than the
 * rare one; the fix is here, at the only place that can see both ends.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIGURE_ID = 'folded-1';

function figure(title = 'Folded model 1'): OristudioCpFoldedFigureEntry {
  return {
    id: FIGURE_ID,
    title,
    handle: 7,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    renderSnapshot: null,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
  } as OristudioCpFoldedFigureEntry;
}

type Gestures = Pick<ReturnType<typeof useFoldedFigures>, 'beginGesture' | 'commitGesture'>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const gestures: { current: Gestures | null } = { current: null };

function Probe(): null {
  const api = useFoldedFigures({ cpDocument: null, selectedFoldLineIds: [] });
  useEffect(() => {
    gestures.current = { beginGesture: api.beginGesture, commitGesture: api.commitGesture };
  }, [api.beginGesture, api.commitGesture]);
  return null;
}

beforeEach(() => {
  useWorkspaceStore.setState({
    // `pushOverlayHistoryEntry` needs a document to record against; nothing here
    // reads its contents.
    oristudioCpDocument: { document: {}, summary: null } as unknown as OristudioCpDocumentState,
    oristudioCpFoldedFigures: [figure()],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    dirty: false,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  gestures.current = null;
});

describe('the folded-figure gesture bracket', () => {
  it('records nothing for a verb that left the figures alone', () => {
    gestures.current?.beginGesture();
    gestures.current?.commitGesture('Fold model');

    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toEqual([]);
    // The other half, and the one the user would actually notice: a stopped fold
    // must not leave the project asking to be saved.
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it('still records one for a verb that changed something', () => {
    gestures.current?.beginGesture();
    act(() => {
      useWorkspaceStore.setState({ oristudioCpFoldedFigures: [figure('Renamed')] });
    });
    gestures.current?.commitGesture('Rename folded model');

    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast[0]?.label).toBe(
      'Rename folded model',
    );
  });

  it('records one when only the active figure moved', () => {
    // Selection is overlay state too: an entry that restores the figures but not
    // which of them was active restores half a step.
    gestures.current?.beginGesture();
    act(() => {
      useWorkspaceStore.setState({ oristudioCpActiveFoldedFigureId: FIGURE_ID });
    });
    gestures.current?.commitGesture('Select folded model');

    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
  });
});

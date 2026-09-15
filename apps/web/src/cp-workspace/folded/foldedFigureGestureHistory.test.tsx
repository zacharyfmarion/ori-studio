import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { annotationGesture } from '../annotations/annotationGesture';
import { anyGestureDraining } from '../canvasObjects/gestureBracket';
import { usePaneGesture, type PaneGesture } from '../canvasObjects/usePaneGesture';
import { foldedFigureGesture } from './foldedFigureGesture';
import { queueFoldedModelWrite, resetFoldedModelWriteQueueForTests } from './foldedModelWriteQueue';
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

type Gestures = Pick<ReturnType<typeof useFoldedFigures>, 'beginGesture' | 'commitGesture'> & {
  /** The Properties pane's side of the same bracket — the one continuous writer. */
  pane: PaneGesture;
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const gestures: { current: Gestures | null } = { current: null };

function Probe(): null {
  const api = useFoldedFigures({ cpDocument: null, selectedFoldLineIds: [] });
  const pane = usePaneGesture(foldedFigureGesture);
  useEffect(() => {
    gestures.current = { beginGesture: api.beginGesture, commitGesture: api.commitGesture, pane };
  }, [api.beginGesture, api.commitGesture, pane]);
  return null;
}

/** A colour tick from the pane: the pane's begin, then a queued kernel write. */
function paneTick(patch: Partial<OristudioCpFoldedFigureModel>) {
  act(() => {
    if (gestures.current?.pane.begin('frontColor')) queueFoldedModelWrite(FIGURE_ID, patch);
  });
}

function paneEnd(label: string) {
  act(() => gestures.current?.pane.end(label));
}

/**
 * A kernel that answers when told to: each write lands the patch on the
 * figure's snapshot model when released, the way the store's own action does
 * once the wasm round trip returns.
 */
function stubKernel() {
  const pending: Array<() => void> = [];
  const update = vi.fn((id: string, patch: Partial<OristudioCpFoldedFigureModel>) => {
    return new Promise<boolean>((resolve) => {
      pending.push(() => {
        useWorkspaceStore.setState({
          oristudioCpFoldedFigures: useWorkspaceStore
            .getState()
            .oristudioCpFoldedFigures.map((candidate) =>
              candidate.id === id
                ? {
                    ...candidate,
                    snapshot: {
                      ...(candidate.snapshot ?? { model: {} }),
                      model: { ...(candidate.snapshot?.model ?? {}), ...patch },
                    } as OristudioCpFoldedFigureEntry['snapshot'],
                  }
                : candidate
            ),
        });
        resolve(true);
      });
    });
  });
  useWorkspaceStore.setState({ updateOristudioCpFoldedFigureModel: update as never });
  const land = async () => {
    await act(async () => {
      pending.shift()?.();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
  };
  return { update, land, inFlight: () => pending.length };
}

beforeEach(() => {
  resetFoldedModelWriteQueueForTests();
  foldedFigureGesture.abortAll();
  annotationGesture.abortAll();
  useWorkspaceStore.setState({
    // `pushOverlayHistoryEntry` needs a document to record against; nothing here
    // reads its contents.
    oristudioCpDocument: { document: {}, summary: null } as unknown as OristudioCpDocumentState,
    oristudioCpFoldedFigures: [figure()],
    // Active, so the hook's model edits have a figure to act on.
    oristudioCpActiveFoldedFigureId: FIGURE_ID,
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
  resetFoldedModelWriteQueueForTests();
  foldedFigureGesture.abortAll();
  annotationGesture.abortAll();
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
      'Rename folded model'
    );
  });

  it('records one when only the active figure moved', () => {
    // Selection is overlay state too: an entry that restores the figures but not
    // which of them was active restores half a step.
    gestures.current?.beginGesture();
    act(() => {
      useWorkspaceStore.setState({ oristudioCpActiveFoldedFigureId: null });
    });
    gestures.current?.commitGesture('Select folded model');

    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
  });
});

describe('a continuous model edit on a flat figure', () => {
  it('records exactly one entry, after the write has landed', async () => {
    // One colour change whose round trip outlives the gesture: the picker
    // blurs at 50 ms, the kernel answers at 250 ms. The entry must be one, and
    // it must be recorded once the store holds what the kernel drew.
    const kernel = stubKernel();
    const past = () => useWorkspaceStore.getState().oristudioCpHistoryPast;
    paneTick({ front_color: { red: 9, green: 9, blue: 9 } });
    expect(kernel.update).toHaveBeenCalledTimes(1);

    paneEnd('Change folded model color');
    // Committing while the write is in flight: nothing recorded yet, and every
    // layer refuses a new gesture until the kernel has answered.
    expect(past()).toHaveLength(0);
    expect(anyGestureDraining()).toBe(true);
    expect(gestures.current?.beginGesture()).toBe(false);
    expect(annotationGesture.begin('canvas')).toBeNull();

    await kernel.land();
    expect(past()).toHaveLength(1);
    expect(past()[0]?.label).toBe('Change folded model color');
    expect(anyGestureDraining()).toBe(false);
    expect(annotationGesture.begin('canvas')).not.toBeNull();
  });

  it('is not staled by a click on another object while it drains', async () => {
    const kernel = stubKernel();
    paneTick({ display_shadows: true });
    paneEnd('Change folded model');
    // A click's begin is refused and its cancel carries a stale token: neither
    // may kill the commit that is waiting on the kernel.
    expect(gestures.current?.beginGesture()).toBe(false);
    act(() => useWorkspaceStore.setState({ oristudioCpActiveFoldedFigureId: null }));

    await kernel.land();
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
  });

  it('coalesces a burst and commits after the last write lands', async () => {
    const kernel = stubKernel();
    for (let tick = 0; tick < 10; tick += 1) {
      paneTick({ front_color: { red: tick, green: 0, blue: 0 } });
    }
    expect(kernel.update).toHaveBeenCalledTimes(1);
    paneEnd('Change folded model color');

    await kernel.land();
    // The coalesced second write is in flight now; still draining.
    expect(kernel.update).toHaveBeenCalledTimes(2);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(0);

    await kernel.land();
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
    const model = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.snapshot?.model;
    expect(model?.front_color).toEqual({ red: 9, green: 0, blue: 0 });
  });
});

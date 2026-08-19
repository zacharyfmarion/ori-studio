import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { useFolded3dRehydration } from './useFolded3dRehydration';

/**
 * The scheduling half of Phase 5: *when* reopened figures are made live.
 *
 * The rule the plan asks for is "after first paint, on idle, one at a time",
 * because a document with a dozen 3D figures would otherwise spend its start-up
 * folding them — R5. That is invisible to look at and cheap to get wrong, so it
 * is asserted here rather than reviewed: the idle callback is stubbed, so a
 * rehydrate that ran without waiting for one shows up as a call that happened
 * before anything was flushed.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function figure(id: string): OristudioCpFoldedFigureEntry {
  return {
    id,
    title: id,
    handle: null,
    sourceKind: 'generated-3d',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d: { model: {}, current_fold_case: 1, discovered_fold_cases: 1 } as never,
    renderSnapshot: {} as never,
    camera: { yaw: 0, pitch: 0, zoom: 1 },
    frameRadius: 40,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    sourceBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    sourceFingerprint: 'abc',
    error: null,
  } as OristudioCpFoldedFigureEntry;
}

const NONE: ReadonlySet<string> = new Set();

/** Idle callbacks the hook has asked for and nobody has run yet. */
const idleTasks = new Map<number, () => void>();
let nextIdleId = 1;

function flushIdle(): void {
  const pending = [...idleTasks.values()];
  idleTasks.clear();
  act(() => {
    for (const task of pending) task();
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let rehydrate: ReturnType<typeof vi.fn>;
/** Resolvers for the rehydrates in flight, so a test decides when one lands. */
let landings: Array<(adopted: boolean) => void>;
const realRehydrate = useWorkspaceStore.getState().rehydrateOristudioCpFolded3dFigure;

function Probe({
  figures,
  staleIds,
  priorityId,
}: {
  figures: readonly OristudioCpFoldedFigureEntry[];
  staleIds: ReadonlySet<string>;
  priorityId: string | null;
}): null {
  useFolded3dRehydration({ figures, staleIds, priorityId });
  return null;
}

function mount(props: {
  figures: readonly OristudioCpFoldedFigureEntry[];
  staleIds?: ReadonlySet<string>;
  priorityId?: string | null;
}): (next?: Partial<Parameters<typeof Probe>[0]>) => void {
  let current = {
    figures: props.figures,
    staleIds: props.staleIds ?? NONE,
    priorityId: props.priorityId ?? null,
  };
  const render = (next?: Partial<typeof current>) => {
    current = { ...current, ...next };
    act(() => {
      root?.render(<Probe {...current} />);
    });
  };
  render();
  return render;
}

/** Resolve the rehydrate in flight and let the hook's follow-up settle. */
async function land(adopted: boolean): Promise<void> {
  const resolve = landings.shift();
  if (!resolve) throw new Error('expected a rehydrate in flight');
  await act(async () => {
    resolve(adopted);
    await Promise.resolve();
  });
}

beforeEach(() => {
  idleTasks.clear();
  nextIdleId = 1;
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    const id = nextIdleId++;
    idleTasks.set(id, () => callback({ didTimeout: false, timeRemaining: () => 0 }));
    return id;
  });
  vi.stubGlobal('cancelIdleCallback', (id: number) => {
    idleTasks.delete(id);
  });
  landings = [];
  rehydrate = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        landings.push(resolve);
      }),
  );
  useWorkspaceStore.setState({
    rehydrateOristudioCpFolded3dFigure: rehydrate as never,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  useWorkspaceStore.setState({ rehydrateOristudioCpFolded3dFigure: realRehydrate });
});

describe('rehydrating reopened figures in the background', () => {
  it('folds nothing until the browser is idle', () => {
    mount({ figures: [figure('a'), figure('b')] });
    // The whole of R5. A rehydrate here would be on the load's critical path,
    // which is where the render model was taken off the entry to avoid being.
    expect(rehydrate).not.toHaveBeenCalled();
    flushIdle();
    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(rehydrate).toHaveBeenCalledWith('a', { pending: false });
  });

  it('folds one figure at a time', async () => {
    const figures = [figure('a'), figure('b'), figure('c')];
    const render = mount({ figures });
    flushIdle();
    expect(rehydrate).toHaveBeenCalledTimes(1);

    // A fresh figures array — any unrelated document change makes one — while
    // 'a' is still folding. This is the case that matters: three concurrent
    // kernel solves would put the cost straight back on the load the whole
    // scheme exists to stay off.
    render({ figures: [...figures] });
    flushIdle();
    expect(rehydrate).toHaveBeenCalledTimes(1);

    await land(false);
    flushIdle();
    expect(rehydrate).toHaveBeenNthCalledWith(2, 'b', { pending: false });
  });

  it('does not ask again about a figure it could not adopt', async () => {
    mount({ figures: [figure('a'), figure('b')] });
    flushIdle();
    await land(false);
    flushIdle();
    await land(false);
    flushIdle();
    // Both were asked once and the queue is empty, rather than 'a' being asked
    // forever because refusing it changed nothing the effect watches.
    expect(rehydrate.mock.calls.map((call) => call[0])).toEqual(['a', 'b']);
  });

  it('never asks about a stale figure', () => {
    mount({ figures: [figure('a'), figure('b')], staleIds: new Set(['a']) });
    flushIdle();
    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(rehydrate).toHaveBeenCalledWith('b', { pending: false });
  });
});

describe('rehydrating the figure the user just pressed', () => {
  it('goes first, at once, and says it is pending', () => {
    const render = mount({ figures: [figure('a'), figure('b')] });
    render({ priorityId: 'b' });
    // No idle flush: someone is waiting on this one, so it is not background
    // work any more.
    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(rehydrate).toHaveBeenCalledWith('b', { pending: true });
  });

  it('waits its turn when it was merely the figure the file was saved with', () => {
    // A document saved with a figure selected would otherwise rehydrate it
    // during start-up, showing "Folding…" under a figure nobody touched.
    mount({ figures: [figure('a'), figure('b')], priorityId: 'b' });
    expect(rehydrate).not.toHaveBeenCalled();
    flushIdle();
    expect(rehydrate).toHaveBeenCalledWith('b', { pending: false });
  });

  it('is not started twice when one is already in flight', async () => {
    const render = mount({ figures: [figure('a'), figure('b')] });
    flushIdle();
    expect(rehydrate).toHaveBeenCalledWith('a', { pending: false });
    render({ priorityId: 'b' });
    // 'a' is still folding. Starting 'b' now would break the one-at-a-time rule
    // the moment a user pressed anything during a load.
    expect(rehydrate).toHaveBeenCalledTimes(1);
    await land(false);
    expect(rehydrate).toHaveBeenNthCalledWith(2, 'b', { pending: true });
  });
});

/**
 * What rehydration costs the start of the app — R5, measured rather than argued.
 *
 * The wall-clock number that would settle it is "how much longer does a document
 * with thirty reopened 3D figures take to become usable", and it cannot be taken
 * here: the automated browser pane never paints (see the Phase 4 note in the
 * plan), and the fold itself runs in a wasm kernel jsdom has not got. So what is
 * measured is the part that is real on the main thread and is the part R5 is
 * actually about — **what the load pays before the browser goes idle**.
 *
 * That has to be two numbers, not one. The first is a count and it is the whole
 * claim: zero folds are started during start-up, at any figure count. The second
 * is the scheduling itself, which is not free and is worth knowing the size of.
 */
describe('what rehydration costs app start', () => {
  const WARM_UP_MOUNTS = 20;
  const TIMED_MOUNTS = 60;

  /** One start-up: mount the surface, let its effects run, tear it down. */
  function mountOnce(figures: readonly OristudioCpFoldedFigureEntry[], rehydrating: boolean): void {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const surface = createRoot(host);
    act(() => {
      surface.render(
        rehydrating ? <Probe figures={figures} staleIds={NONE} priorityId={null} /> : <Inert />,
      );
    });
    act(() => surface.unmount());
    host.remove();
  }

  /** The same mount with no rehydration in it — the "before" of the pair. */
  function Inert(): null {
    return null;
  }

  /**
   * Both arms of one comparison, interleaved.
   *
   * Run as two blocks they measure the JIT and the GC as much as the code: the
   * second block inherits whatever state the first left. Alternating puts that
   * drift into both sides equally.
   */
  function msPerMount(figures: readonly OristudioCpFoldedFigureEntry[]): {
    before: number;
    after: number;
    /** Median of the per-pair differences — see the assertion below. */
    added: number;
  } {
    for (let run = 0; run < WARM_UP_MOUNTS; run += 1) {
      mountOnce(figures, false);
      mountOnce(figures, true);
    }
    let before = 0;
    let after = 0;
    const deltas: number[] = [];
    for (let run = 0; run < TIMED_MOUNTS; run += 1) {
      const withoutStarted = performance.now();
      mountOnce(figures, false);
      const without = performance.now() - withoutStarted;
      const withStarted = performance.now();
      mountOnce(figures, true);
      const withIt = performance.now() - withStarted;
      before += without;
      after += withIt;
      deltas.push(withIt - without);
    }
    deltas.sort((l, r) => l - r);
    return {
      before: before / TIMED_MOUNTS,
      after: after / TIMED_MOUNTS,
      added: deltas[Math.floor(deltas.length / 2)] ?? 0,
    };
  }

  it('starts no folds before the browser is idle, at any figure count', () => {
    for (const count of [1, 10, 30]) {
      const figures = Array.from({ length: count }, (_, index) => figure(`figure-${index}`));
      rehydrate.mockClear();
      idleTasks.clear();
      mountOnce(figures, true);
      // The load is over and nothing has been folded. Everything queued is
      // waiting for an idle callback that start-up never gives it.
      expect(rehydrate).not.toHaveBeenCalled();
    }
  });

  it('adds a scheduling cost far below a frame', () => {
    const rows: string[] = [];
    let worstAdded = 0;
    for (const count of [1, 10, 30]) {
      const figures = Array.from({ length: count }, (_, index) => figure(`figure-${index}`));
      const { before, after, added } = msPerMount(figures);
      worstAdded = Math.max(worstAdded, added);
      rows.push(`${count}: ${before.toFixed(4)} -> ${after.toFixed(4)} ms`);
    }
    // Reported so the numbers are in the run rather than only in a commit
    // message that will go stale.
    console.log(`[folded-3d rehydration] mount cost, before -> after — ${rows.join(' | ')}`);
    // Locally this lands at 0.006–0.031 ms of a 16.7 ms frame, and does not
    // grow from 10 figures to 30 — the effect walks the list once and then
    // waits. The bound is deliberately far looser than that, because a loaded CI
    // box is several times slower and this is a smoke test, not the measurement:
    // the measurement is the line above, and the claim that matters is the
    // zero-folds one in the test before this.
    //
    // The **median** of the per-pair differences, not the difference of the two
    // means: one GC pause inside sixty mounts moves a mean by more than the whole
    // effect being measured, which is how this went red once in two full-suite
    // runs against code that had not changed. Real work at mount would lift
    // every pair, so a median catches it and an outlier no longer fakes it.
    expect(worstAdded).toBeLessThan(1);
  });
});

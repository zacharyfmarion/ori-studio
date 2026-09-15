import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedFigureModel } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  drainFoldedModelWrites,
  foldedModelWriteInFlight,
  pendingFoldedModelWrites,
  queueFoldedModelWrite,
  resetFoldedModelWriteQueueForTests,
  supersedeFoldedModelWrites,
} from './foldedModelWriteQueue';

/**
 * The single-flight queue in front of the kernel: a burst becomes at most two
 * round trips, nothing is lost, the drain resolves after the last write, and
 * an undo mid-drag drops what was waiting and stales what is in flight.
 */
const initialState = useWorkspaceStore.getInitialState();

/** A kernel that answers when told to, recording every write it was handed. */
function stubKernel() {
  const writes: Array<Partial<OristudioCpFoldedFigureModel>> = [];
  const pending: Array<() => void> = [];
  const update = vi.fn((_id: string, patch: Partial<OristudioCpFoldedFigureModel>) => {
    writes.push(patch);
    return new Promise<boolean>((resolve) => {
      pending.push(() => resolve(true));
    });
  });
  const supersede = vi.fn();
  useWorkspaceStore.setState({
    updateOristudioCpFoldedFigureModel: update as never,
    supersedeOristudioCpFoldedFigureModelWrites: supersede,
  });
  const land = async () => {
    pending.shift()?.();
    // Let the queue's own continuation run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { writes, land, update, supersede };
}

beforeEach(() => {
  resetFoldedModelWriteQueueForTests();
});

afterEach(() => {
  resetFoldedModelWriteQueueForTests();
  useWorkspaceStore.setState(initialState, true);
});

describe('foldedModelWriteQueue', () => {
  it('coalesces a burst into at most two round trips', async () => {
    const kernel = stubKernel();
    for (let tick = 0; tick < 40; tick += 1) {
      queueFoldedModelWrite('figure-1', { front_color: { red: tick, green: 0, blue: 0 } });
    }
    expect(kernel.update).toHaveBeenCalledTimes(1);
    expect(foldedModelWriteInFlight('figure-1')).toBe(true);

    await kernel.land();
    expect(kernel.update).toHaveBeenCalledTimes(2);
    // The second carries the last tick, not the second one.
    expect(kernel.writes[1]).toEqual({ front_color: { red: 39, green: 0, blue: 0 } });

    await kernel.land();
    expect(kernel.update).toHaveBeenCalledTimes(2);
    expect(foldedModelWriteInFlight('figure-1')).toBe(false);
  });

  it('lands two fields issued back to back, both', async () => {
    const kernel = stubKernel();
    queueFoldedModelWrite('figure-1', { front_color: { red: 1, green: 2, blue: 3 } });
    queueFoldedModelWrite('figure-1', { back_color: { red: 4, green: 5, blue: 6 } });
    queueFoldedModelWrite('figure-1', { display_shadows: true });
    await kernel.land();
    // The waiting patches merged into one write carrying both fields.
    expect(kernel.writes[1]).toEqual({
      back_color: { red: 4, green: 5, blue: 6 },
      display_shadows: true,
    });
  });

  it('keeps figures independent', async () => {
    const kernel = stubKernel();
    queueFoldedModelWrite('figure-1', { display_shadows: true });
    queueFoldedModelWrite('figure-2', { display_shadows: false });
    expect(kernel.update).toHaveBeenCalledTimes(2);
  });

  it('resolves the drain after the last write, and at once with nothing in flight', async () => {
    expect(pendingFoldedModelWrites()).toBeNull();
    await expect(drainFoldedModelWrites()).resolves.toBeUndefined();

    const kernel = stubKernel();
    queueFoldedModelWrite('figure-1', { display_shadows: true });
    queueFoldedModelWrite('figure-1', { anti_alias: true });
    let drained = false;
    const drain = drainFoldedModelWrites('figure-1').then(() => {
      drained = true;
    });
    await kernel.land();
    // The first write landed, the queued one is in flight: not drained yet.
    expect(drained).toBe(false);
    await kernel.land();
    await drain;
    expect(drained).toBe(true);
    expect(kernel.update).toHaveBeenCalledTimes(2);
  });

  it('drops the queued patch on supersede and stales the write in flight', async () => {
    const kernel = stubKernel();
    queueFoldedModelWrite('figure-1', { display_shadows: true });
    queueFoldedModelWrite('figure-1', { anti_alias: true });

    supersedeFoldedModelWrites();
    expect(kernel.supersede).toHaveBeenCalledTimes(1);

    await kernel.land();
    // Nothing waiting any more: the second write never issues.
    expect(kernel.update).toHaveBeenCalledTimes(1);
    expect(foldedModelWriteInFlight('figure-1')).toBe(false);
  });

  it('carries on past a write that failed', async () => {
    const writes: number[] = [];
    let first = true;
    useWorkspaceStore.setState({
      updateOristudioCpFoldedFigureModel: vi.fn(() => {
        writes.push(writes.length);
        if (first) {
          first = false;
          return Promise.reject(new Error('kernel gone'));
        }
        return Promise.resolve(true);
      }) as never,
    });
    queueFoldedModelWrite('figure-1', { display_shadows: true });
    queueFoldedModelWrite('figure-1', { anti_alias: true });
    await drainFoldedModelWrites('figure-1');
    expect(writes).toHaveLength(2);
  });
});

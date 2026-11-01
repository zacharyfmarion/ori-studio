/**
 * One Default-spread lease per Edit figure, held for its fold: replaced with
 * the fold, released with the figure, and checked when it answers, so a solve
 * never lands on a fold that has been superseded.
 */
import { describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import type { ConnectedLease } from '../../layer-spread/prepareConnected';
import { FoldedSpreadPreparations } from './foldedFlatSpreadLeases';

interface FakeLease {
  scene: OristudioCpFoldedPaperScene;
  priority: number;
  released: boolean;
  resolve: (prepared: PreparedConnectedSpread) => void;
  reject: (error: unknown) => void;
}

function harness() {
  const leases: FakeLease[] = [];
  const settled = vi.fn();
  const prepare = (scene: OristudioCpFoldedPaperScene, _yUp: boolean, priority: number): ConnectedLease => {
    let resolve!: FakeLease['resolve'];
    let reject!: FakeLease['reject'];
    const promise = new Promise<PreparedConnectedSpread>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const lease: FakeLease = { scene, priority, released: false, resolve, reject };
    leases.push(lease);
    return {
      promise,
      release: () => {
        lease.released = true;
        reject(new DOMException('Layer spread released', 'AbortError'));
      },
    };
  };
  return { leases, settled, preparations: new FoldedSpreadPreparations(settled, prepare) };
}

const scene = (name: string) => ({ name }) as unknown as OristudioCpFoldedPaperScene;
const solved = (name: string) => ({ name }) as unknown as PreparedConnectedSpread;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('FoldedSpreadPreparations', () => {
  it('holds one lease per figure, and lands its solve for that fold', async () => {
    const { leases, settled, preparations } = harness();
    const a = scene('a');
    preparations.sync([{ id: 'f1', fold: a, scene: a, priority: 1 }]);
    preparations.sync([{ id: 'f1', fold: a, scene: a, priority: 1 }]);
    expect(leases).toHaveLength(1);
    expect(preparations.state('f1', a)).toEqual({ status: 'preparing' });
    leases[0]!.resolve(solved('a'));
    await flush();
    expect(preparations.state('f1', a)).toEqual({ status: 'ready', prepared: solved('a') });
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('lets a superseded fold go, and never lands its late solve on the new one', async () => {
    const { leases, settled, preparations } = harness();
    const before = scene('before');
    const after = scene('after');
    preparations.sync([{ id: 'f1', fold: before, scene: before, priority: 1 }]);
    // A refold, another solution, a side flip, an undo: a new scene for the figure.
    preparations.sync([{ id: 'f1', fold: after, scene: after, priority: 1 }]);
    expect(leases[0]!.released).toBe(true);
    expect(leases).toHaveLength(2);
    leases[0]!.resolve(solved('before'));
    await flush();
    expect(preparations.state('f1', after)).toEqual({ status: 'preparing' });
    expect(preparations.state('f1', before)).toEqual({ status: 'preparing' });
    expect(settled).not.toHaveBeenCalled();
    leases[1]!.resolve(solved('after'));
    await flush();
    expect(preparations.state('f1', after)).toMatchObject({ status: 'ready' });
  });

  it('keeps the lease and its solve for a new scene of the same fold, as an aux-line refetch hands over', async () => {
    const { leases, preparations } = harness();
    const fold = {};
    const first = scene('first');
    const refetched = scene('refetched');
    preparations.sync([{ id: 'f1', fold, scene: first, priority: 1 }]);
    leases[0]!.resolve(solved('first'));
    await flush();
    // Asked by the fold, as the canvas asks in the render the new scene lands
    // in, before it syncs: the faces and stacks are the fold's, so its solve
    // still answers for the new scene.
    expect(preparations.state('f1', fold)).toEqual({ status: 'ready', prepared: solved('first') });
    preparations.sync([{ id: 'f1', fold, scene: refetched, priority: 1 }]);
    expect(leases).toHaveLength(1);
    expect(leases[0]!.released).toBe(false);
    expect(preparations.state('f1', fold)).toEqual({ status: 'ready', prepared: solved('first') });
    expect(preparations.state('f1', {})).toEqual({ status: 'preparing' });
  });

  it('releases a figure that went, or whose spread can no longer draw', async () => {
    const { leases, settled, preparations } = harness();
    const a = scene('a');
    const b = scene('b');
    preparations.sync([
      { id: 'f1', fold: a, scene: a, priority: 1 },
      { id: 'f2', fold: b, scene: b, priority: 0 },
    ]);
    preparations.sync([{ id: 'f2', fold: b, scene: b, priority: 0 }]);
    expect(leases.map((lease) => lease.released)).toEqual([true, false]);
    leases[0]!.resolve(solved('a'));
    await flush();
    expect(settled).not.toHaveBeenCalled();
  });

  it('asks again at the higher priority before letting go, once a waiting figure is selected or in view', () => {
    const { leases, preparations } = harness();
    const a = scene('a');
    preparations.sync([{ id: 'f1', fold: a, scene: a, priority: 0 }]);
    preparations.sync([{ id: 'f1', fold: a, scene: a, priority: 1 }]);
    expect(leases.map(({ priority, released }) => ({ priority, released }))).toEqual([
      { priority: 0, released: true },
      { priority: 1, released: false },
    ]);
    // Never lower again for a lease already taken.
    preparations.sync([{ id: 'f1', fold: a, scene: a, priority: 0 }]);
    expect(leases).toHaveLength(2);
  });

  it('says a failed solve is unavailable, and takes its own release for no failure', async () => {
    const { leases, settled, preparations } = harness();
    const a = scene('a');
    preparations.sync([{ id: 'f1', fold: a, scene: a, priority: 1 }]);
    leases[0]!.reject(new Error('Layer spread exceeded its time budget'));
    await flush();
    expect(preparations.state('f1', a)).toEqual({ status: 'unavailable' });
    expect(settled).toHaveBeenCalledTimes(1);

    const b = scene('b');
    preparations.sync([{ id: 'f1', fold: b, scene: b, priority: 1 }]);
    preparations.sync([]);
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('releases everything on dispose and keeps nothing that lands after', async () => {
    const { leases, settled, preparations } = harness();
    const a = scene('a');
    preparations.sync([{ id: 'f1', fold: a, scene: a, priority: 1 }]);
    preparations.dispose();
    expect(leases[0]!.released).toBe(true);
    leases[0]!.resolve(solved('a'));
    await flush();
    expect(settled).not.toHaveBeenCalled();
    preparations.sync([{ id: 'f1', fold: a, scene: a, priority: 1 }]);
    expect(leases).toHaveLength(1);
  });
});

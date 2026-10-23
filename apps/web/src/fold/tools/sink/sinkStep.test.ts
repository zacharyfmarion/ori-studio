import { describe, expect, it } from 'vitest';
import type { FoldPocket } from '../../engine/foldEngineSinkWire';
import { MAX_SINK_ORDERS, pocketNames, pocketsAsSeen, sinkOrderPicks } from './sinkStep';

const pocket = (upper: number[], lower: number[]): FoldPocket => ({
  upper,
  lower,
  seams: [1, 2],
  stored: { above: [0.1, 0.2], below: [0.3, 0.4] },
});

describe('sinkOrderPicks', () => {
  it('lists nothing for a decided sink, or one with a single order', () => {
    expect(sinkOrderPicks(null)).toEqual([]);
    expect(sinkOrderPicks({ count: { orders: 1, exact: true }, components: [] })).toEqual([]);
    expect(sinkOrderPicks({ count: { orders: 1, exact: true }, components: [{ orders: 1, truncated: false }] })).toEqual([]);
  });

  it('steps every component’s listed orders, the first component slowest', () => {
    const orders = {
      count: { orders: 6, exact: true },
      components: [
        { orders: 2, truncated: false },
        { orders: 3, truncated: false },
      ],
    };
    expect(sinkOrderPicks(orders)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
  });

  it('stops at the most the chooser steps through', () => {
    const orders = { count: { orders: 400, exact: false }, components: [{ orders: 20, truncated: true }, { orders: 20, truncated: false }] };
    const picks = sinkOrderPicks(orders);
    expect(picks).toHaveLength(MAX_SINK_ORDERS);
    expect(picks[0]).toEqual([0, 0]);
  });
});

describe('pocketNames', () => {
  it('names two pockets front and back by the faces between each and the viewer', () => {
    const front = pocket([4], [5, 6, 7]);
    const back = pocket([4, 5, 6], [7]);
    expect(pocketNames([back, front], false)).toEqual(['back', 'front']);
    // Turned over, the viewer sees the model's underside first.
    expect(pocketNames([back, front], true)).toEqual(['front', 'back']);
  });

  it('orders the pockets front to back as the viewer sees them, keeping the engine’s order for a tie', () => {
    const front = pocket([4], [5, 6, 7]);
    const back = pocket([4, 5, 6], [7]);
    expect(pocketsAsSeen([back, front], false)).toEqual([front, back]);
    expect(pocketNames(pocketsAsSeen([back, front], false), false)).toEqual(['front', 'back']);
    // Turned over, the model's underside is in front.
    expect(pocketsAsSeen([front, back], true)).toEqual([back, front]);
    const tied = [pocket([1], [2, 3]), pocket([2], [1, 3])];
    expect(pocketsAsSeen(tied, false)).toEqual(tied);
  });

  it('numbers any other count, and two the viewer sees no nearer', () => {
    expect(pocketNames([pocket([1], [2])], false)).toEqual([null]);
    expect(pocketNames([pocket([1], [2, 3]), pocket([2], [1, 3])], false)).toEqual([null, null]);
    expect(pocketNames([pocket([1], [2]), pocket([1, 2], []), pocket([], [1, 2])], false)).toEqual([null, null, null]);
  });
});

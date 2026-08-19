import { useCallback, useEffect, useRef } from 'react';
import { useEventCallback } from './useEventCallback';
import {
  sameBpDeviceUpdate,
  sameBpDragUpdate,
  sameBpReshapeUpdate,
  type BpPackingDeviceBackendUpdate,
  type BpPackingDragBackendUpdate,
  type BpPackingReshapeBackendUpdate,
} from '../lib/bpPackingDragRequests';
import type { BpFlapFootprint } from '../lib/bpFlapReshape';

/**
 * How the packing pane talks to the engine while something is being dragged.
 *
 * Three rules, and all three exist because the engine is expensive:
 *
 * - **At most one request per frame.** Pointer samples arrive faster than the
 *   engine can answer, and only the newest one is worth asking about.
 * - **Never the same request twice.** The position is grid-snapped before it is
 *   sent, so crossing one cell yields a run of identical requests. See
 *   {@link sameBpDragUpdate}.
 * - **One at a time.** Requests are chained, so a slow solve cannot be overtaken
 *   by the next sample and land out of order.
 *
 * The release is different and deliberately unconditional: it carries
 * `dragging: false`, which settles the design and closes the undo entry, so it
 * has to go even when the position has not changed since the last mid-drag
 * request.
 *
 * This lives beside the pane rather than in it because it is a concern with a
 * small interface — the engine moves in, six verbs out — and the pane is a
 * composition site.
 */

export interface BpPackingDragRequestActions {
  moveFlap: (
    id: number,
    loc: BpPackingDragBackendUpdate['loc'],
    dragging: boolean,
  ) => Promise<unknown>;
  moveFlaps: (
    ids: number[],
    loc: BpPackingDragBackendUpdate['loc'],
    dragging: boolean,
  ) => Promise<unknown>;
  moveDevice: (
    stretchId: string,
    index: number,
    loc: BpPackingDeviceBackendUpdate['loc'],
    dragging: boolean,
  ) => Promise<unknown>;
  reshapeFlap: (id: number, footprint: BpFlapFootprint, dragging: boolean) => Promise<unknown>;
}

export interface BpPackingDragRequests {
  /** A gesture is starting; its first request must go even if it repeats. */
  beginFlapDrag: () => void;
  queueFlapDrag: (update: BpPackingDragBackendUpdate) => void;
  /** The gesture ended: settle the design at this position. */
  flushFlapDrag: (update: BpPackingDragBackendUpdate) => void;
  beginDeviceDrag: () => void;
  queueDeviceDrag: (update: BpPackingDeviceBackendUpdate) => void;
  flushDeviceDrag: (update: BpPackingDeviceBackendUpdate) => void;
  beginFlapReshape: () => void;
  queueFlapReshape: (update: BpPackingReshapeBackendUpdate) => void;
  flushFlapReshape: (update: BpPackingReshapeBackendUpdate) => void;
}

/** One drag's outstanding work: the frame it owns, the newest sample, the last sent. */
interface RequestChannel<T> {
  frame: number | null;
  pending: T | null;
  sent: T | null;
  queue: Promise<void> | null;
}

function emptyChannel<T>(): RequestChannel<T> {
  return { frame: null, pending: null, sent: null, queue: null };
}

export function useBpPackingDragRequests(
  actions: BpPackingDragRequestActions,
): BpPackingDragRequests {
  const flap = useRef<RequestChannel<BpPackingDragBackendUpdate>>(emptyChannel());
  const device = useRef<RequestChannel<BpPackingDeviceBackendUpdate>>(emptyChannel());
  // A separate channel from the move: a gesture is one or the other, and giving
  // them one channel would let a reshape's rAF cancel a move's in a stray
  // overlap.
  const reshape = useRef<RequestChannel<BpPackingReshapeBackendUpdate>>(emptyChannel());
  // Wrapped so the returned verbs keep one identity for the life of the pane,
  // whatever the store hands back this render.
  const moveFlap = useEventCallback(actions.moveFlap);
  const moveFlaps = useEventCallback(actions.moveFlaps);
  const moveDevice = useEventCallback(actions.moveDevice);
  const reshapeFlap = useEventCallback(actions.reshapeFlap);

  /** Chain onto whatever is in flight, so answers cannot arrive out of order. */
  const chain = <T>(channel: RequestChannel<T>, run: () => Promise<unknown>) => {
    const queued = channel.queue;
    const next = queued
      ? queued.then(
          () => run(),
          () => run(),
        )
      : run();
    const guarded = next.then(
      () => undefined,
      () => undefined,
    );
    channel.queue = guarded;
    void guarded.finally(() => {
      if (channel.queue === guarded) channel.queue = null;
    });
  };

  const sendFlap = useCallback(
    (update: BpPackingDragBackendUpdate, dragging: boolean) => {
      if (update.ids.length === 0) return;
      const channel = flap.current;
      channel.sent = update;
      chain(channel, () => {
        if (update.ids.length > 1) return moveFlaps(update.ids, update.loc, dragging);
        const id = update.ids[0];
        return id === undefined ? Promise.resolve() : moveFlap(id, update.loc, dragging);
      });
    },
    [moveFlap, moveFlaps],
  );

  const sendReshape = useCallback(
    (update: BpPackingReshapeBackendUpdate, dragging: boolean) => {
      const channel = reshape.current;
      channel.sent = update;
      chain(channel, () => reshapeFlap(update.id, update.footprint, dragging));
    },
    [reshapeFlap],
  );

  const sendDevice = useCallback(
    (update: BpPackingDeviceBackendUpdate, dragging: boolean) => {
      const channel = device.current;
      channel.sent = update;
      chain(channel, () => moveDevice(update.stretchId, update.index, update.loc, dragging));
    },
    [moveDevice],
  );

  /**
   * Schedule a frame, unless the newest sample says nothing new.
   *
   * `pending` is recorded before any early return, so a frame already in flight
   * always sends the newest sample rather than the one that scheduled it.
   */
  const schedule = <T>(
    channel: RequestChannel<T>,
    update: T,
    same: (sent: T | null, next: T) => boolean,
    send: (update: T, dragging: boolean) => void,
  ) => {
    channel.pending = update;
    if (channel.frame !== null) return;
    if (same(channel.sent, update)) return;
    // A scheduler that runs its callback synchronously — test stubs do — has
    // already cleared the slot by the time it hands back a handle. Storing it
    // then would leave a frame that has been and gone marked as in flight, and
    // every later sample would be dropped as "already scheduled".
    let ran = false;
    const handle = requestAnimationFrame(() => {
      ran = true;
      channel.frame = null;
      const next = channel.pending;
      channel.pending = null;
      if (next === null || same(channel.sent, next)) return;
      send(next, true);
    });
    if (!ran) channel.frame = handle;
  };

  const flush = <T>(
    channel: RequestChannel<T>,
    update: T,
    send: (update: T, dragging: boolean) => void,
  ) => {
    if (channel.frame !== null) cancelAnimationFrame(channel.frame);
    channel.frame = null;
    channel.pending = null;
    send(update, false);
    channel.sent = null;
  };

  useEffect(
    () => () => {
      for (const channel of [
        flap.current,
        device.current,
        reshape.current,
      ] as RequestChannel<unknown>[]) {
        if (channel.frame !== null) cancelAnimationFrame(channel.frame);
        channel.frame = null;
        channel.pending = null;
        channel.sent = null;
      }
    },
    [],
  );

  return {
    beginFlapDrag: useCallback(() => {
      flap.current.sent = null;
    }, []),
    queueFlapDrag: useCallback(
      (update) => schedule(flap.current, update, sameBpDragUpdate, sendFlap),
      [sendFlap],
    ),
    flushFlapDrag: useCallback((update) => flush(flap.current, update, sendFlap), [sendFlap]),
    beginDeviceDrag: useCallback(() => {
      device.current.sent = null;
    }, []),
    queueDeviceDrag: useCallback(
      (update) => schedule(device.current, update, sameBpDeviceUpdate, sendDevice),
      [sendDevice],
    ),
    flushDeviceDrag: useCallback(
      (update) => flush(device.current, update, sendDevice),
      [sendDevice],
    ),
    beginFlapReshape: useCallback(() => {
      reshape.current.sent = null;
    }, []),
    queueFlapReshape: useCallback(
      (update) => schedule(reshape.current, update, sameBpReshapeUpdate, sendReshape),
      [sendReshape],
    ),
    flushFlapReshape: useCallback(
      (update) => flush(reshape.current, update, sendReshape),
      [sendReshape],
    ),
  };
}

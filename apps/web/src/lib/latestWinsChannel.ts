/**
 * Latest request wins, over any engine that answers one call at a time.
 *
 * A worker answers its calls in order, so a preview per pointer move would
 * queue behind every earlier one and the answer on screen would trail the
 * pointer further each frame. Instead at most one request is in flight and
 * one waits: a newer request replaces the waiting one, which never reaches the
 * engine, and makes the one in flight superseded, its answer discarded when it
 * comes.
 *
 * Stopping a request already in the engine is not this channel's job: an
 * engine call cannot be interrupted, so its owner terminates the worker for
 * that. One channel per preview stream, so two streams never supersede each
 * other.
 *
 * Its users: the Fold engine's previews (`createFoldPreviewChannel`,
 * `store/workspaceStore/foldSequenceRuntime.ts`) and the Layer order dialog's
 * (`layer-order/engine/layerOrderRuntime.ts`).
 *
 * React-free, store-free and engine-free.
 */

/** A request's answer, or word that a newer request replaced it. */
export type LatestWinsResult<T> = { status: 'answered'; value: T } | { status: 'superseded' };

export interface LatestWinsChannel<C> {
  /**
   * Ask the engine. Resolves with the answer, or `superseded` as soon as a
   * newer request (or {@link LatestWinsChannel.cancel}) replaces this one.
   * An answer that arrives superseded is handed to `discard`, so a landed
   * preview's handle can be released. Rejects only while still the newest.
   */
  request<T>(ask: (client: C) => Promise<T>, discard?: (value: T) => void): Promise<LatestWinsResult<T>>;
  /** Supersede whatever is in flight or waiting, asking nothing new. */
  cancel(): void;
}

/**
 * How a channel reaches its engine: run `ask` against the live client, and
 * settle as it does. The engine's owner guards it (a worker that goes away
 * rejects it), so the channel never needs to know about workers.
 */
export type LatestWinsSend<C> = <T>(ask: (client: C) => Promise<T>) => Promise<T>;

interface Waiting {
  ticket: number;
  run: () => void;
  supersede: () => void;
}

export function createLatestWinsChannel<C>(send: LatestWinsSend<C>): LatestWinsChannel<C> {
  let latest = 0;
  let busy = false;
  let waiting: Waiting | null = null;

  const next = () => {
    busy = false;
    const queued = waiting;
    waiting = null;
    queued?.run();
  };

  const sent = <T>(ask: (client: C) => Promise<T>): Promise<T> => {
    try {
      return send(ask);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  return {
    request<T>(ask: (client: C) => Promise<T>, discard?: (value: T) => void): Promise<LatestWinsResult<T>> {
      const ticket = ++latest;
      return new Promise<LatestWinsResult<T>>((resolve, reject) => {
        const run = () => {
          if (ticket !== latest) {
            resolve({ status: 'superseded' });
            next();
            return;
          }
          busy = true;
          sent(ask).then(
            (value) => {
              if (ticket === latest) resolve({ status: 'answered', value });
              else {
                discard?.(value);
                resolve({ status: 'superseded' });
              }
              next();
            },
            (error: unknown) => {
              if (ticket === latest) reject(error);
              else resolve({ status: 'superseded' });
              next();
            }
          );
        };
        waiting?.supersede();
        if (busy) {
          waiting = { ticket, run, supersede: () => resolve({ status: 'superseded' }) };
        } else {
          waiting = null;
          run();
        }
      });
    },

    cancel() {
      latest += 1;
      waiting?.supersede();
      waiting = null;
    },
  };
}

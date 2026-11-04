/**
 * Each Edit figure's Default-spread solve: one `prepareConnected` lease per
 * figure, on the paper scene of the fold it shows now.
 *
 * The lease is held for the fold's life, never an amount's or a reveal's: an
 * Amount drag re-projects the prepared solve and solves nothing. It goes when
 * the figure does, when its spread is turned off or can no longer draw, and
 * when its fold is replaced — a refold, another solution, a side flip, an
 * undo or redo across one, another document — since each of those hands the
 * figure a new fold. A write of its colours, which the kernel answers with a
 * new snapshot of the same fold, does not. A late answer is checked against
 * the lease it was asked with, so a solve never lands on a fold that has been
 * superseded.
 *
 * A new scene of the same fold — the kernel asked again because the
 * document's aux lines changed — has the same faces and stacks, so the solve
 * the figure holds still answers for it: the lease is kept and the figure
 * keeps drawing spread, now with the new lines.
 *
 * Priority 1 for the selected figure and the ones in view, 0 for the rest: a
 * thumbnail's solve, or a figure off screen, waits behind the one being looked
 * at. A waiting figure that becomes selected or comes into view asks again at
 * 1 before letting go of its first lease, so the preparation and the solve it
 * shares are never dropped in between.
 *
 * React-free; the hook beside it (`useFoldedFlatSpread`) runs it.
 */

import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { prepareConnected, type ConnectedLease } from '../../layer-spread/prepareConnected';

/** What a lease is held for: a value key, or an object compared by identity. Never nullish, so no figure's absent lease matches. */
export type SpreadFold = string | object;

export interface SpreadPreparationRequest {
  readonly id: string;
  /** The fold the scene is of, compared with `===`: the key the drawing side holds it by (`spreadFold`). */
  readonly fold: SpreadFold;
  readonly scene: OristudioCpFoldedPaperScene;
  /** 1 for the selected figure and the ones in view, 0 for the rest. */
  readonly priority: number;
}

export type SpreadPreparationState =
  | { readonly status: 'preparing' }
  | { readonly status: 'ready'; readonly prepared: PreparedConnectedSpread }
  | { readonly status: 'unavailable' };

const PREPARING: SpreadPreparationState = { status: 'preparing' };

type Prepare = (scene: OristudioCpFoldedPaperScene, yUp: boolean, priority: number) => ConnectedLease;

interface Held {
  readonly fold: SpreadFold;
  /** The fold's latest scene: what the figure is drawn from. */
  scene: OristudioCpFoldedPaperScene;
  priority: number;
  lease: ConnectedLease | null;
  state: SpreadPreparationState;
}

const released = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

export class FoldedSpreadPreparations {
  private readonly held = new Map<string, Held>();
  private disposed = false;

  constructor(
    /** Told when a figure's solve lands or fails, so its picture can be drawn or its reason shown. */
    private readonly onSettle: () => void,
    private readonly prepare: Prepare = prepareConnected
  ) {}

  /** Hold exactly these: a lease per figure on its scene, every other one released. */
  sync(requests: readonly SpreadPreparationRequest[]): void {
    if (this.disposed) return;
    const wanted = new Set<string>();
    for (const { id, fold, scene, priority } of requests) {
      wanted.add(id);
      const held = this.held.get(id);
      if (held?.fold === fold) {
        held.scene = scene;
        if (held.state.status === 'preparing' && priority > held.priority) this.lease(id, held, priority);
        continue;
      }
      held?.lease?.release();
      const next: Held = { fold, scene, priority, lease: null, state: PREPARING };
      this.held.set(id, next);
      this.lease(id, next, priority);
    }
    for (const [id, held] of this.held) {
      if (wanted.has(id)) continue;
      held.lease?.release();
      this.held.delete(id);
    }
  }

  /**
   * Where the figure's solve for `fold` stands; preparing while none is held
   * for that fold. Asked by the fold, as leases are held, so a new scene of
   * the same fold has its solve at once: in the very render that brings the
   * scene, before `sync` is told of it.
   */
  state(id: string, fold: SpreadFold): SpreadPreparationState {
    const held = this.held.get(id);
    return held?.fold === fold ? held.state : PREPARING;
  }

  /** Release every lease; nothing that lands afterwards is kept. */
  dispose(): void {
    this.disposed = true;
    for (const held of this.held.values()) held.lease?.release();
    this.held.clear();
  }

  private lease(id: string, held: Held, priority: number): void {
    const previous = held.lease;
    const lease = this.prepare(held.scene, false, priority);
    held.lease = lease;
    held.priority = priority;
    // After the new lease is taken, so what the two share lives on.
    previous?.release();
    const current = () => !this.disposed && this.held.get(id) === held && held.lease === lease;
    lease.promise.then(
      (prepared) => {
        if (!current()) return;
        held.state = { status: 'ready', prepared };
        this.onSettle();
      },
      (error: unknown) => {
        if (!current() || released(error)) return;
        held.state = { status: 'unavailable' };
        this.onSettle();
      }
    );
  }
}

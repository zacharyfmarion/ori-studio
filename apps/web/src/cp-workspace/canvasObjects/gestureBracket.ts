import { registerCanvasSessionEnder } from './canvasSessions';

/**
 * One undo bracket per overlay layer, held at module level.
 *
 * Every edit to an overlay layer (annotations, folded figures, inline
 * simulations) is "snapshot before, mutate freely, record once with a label" —
 * a drag or a slider is many store writes and one history entry. Each concern
 * hook used to hold that snapshot in a ref of its own with no nesting guard, so
 * a second `begin` silently overwrote the first's baseline; the crease-pattern
 * panel only avoided the overlap by unmounting every other floating surface
 * while one was live. A Properties pane in another dock panel stays mounted
 * through canvas drags, so the bracket has to be one object both can reach.
 *
 * Rules, each pinned by `gestureBracket.test.ts`:
 *
 * - **Overlap is refused, not clobbered.** `begin` from a different owner
 *   returns null while the bracket is open. Same-owner re-entry returns the
 *   open token — the folded `scope` protocol, where one control calls
 *   `updateModel(update, scope)` repeatedly and ends once.
 * - **Refusal is global while anything drains.** Overlay history entries
 *   capture every layer live, so two brackets open across a commit's
 *   `beforeCommit` would each capture the other layer at the wrong moment. While
 *   any bracket's commit is draining, `begin` on every layer returns null.
 * - **A stale token is inert.** `commit` and `abort` with a token that is not
 *   the open one do nothing, so a click on the canvas cannot kill a pane commit
 *   that is draining and a row whose bracket was aborted underneath it cannot
 *   record a baseline that no longer exists.
 * - **A commit that changed nothing records nothing**, so the store's
 *   `pushOverlayHistoryEntry` can stay unconditional.
 */
export interface GestureToken {
  readonly layer: string;
  readonly owner: string;
  readonly seq: number;
}

export interface GestureBracket {
  /**
   * Open the layer's bracket. Null while a different owner holds it or while any
   * layer's commit is draining; the open token again for the same owner.
   */
  begin(owner: string): GestureToken | null;
  /**
   * Record one entry if anything changed since begin; a no-op for a stale token.
   * Resolves after `beforeCommit`, and the token is held until then. Synchronous
   * up to the record when there is nothing to drain.
   */
  commit(token: GestureToken, label: string): Promise<void>;
  /** Drop `token`'s open snapshot without recording. A no-op for a stale token. */
  abort(token: GestureToken): void;
  /** Drop whatever is open, whoever holds it — the session chokepoint's verb. */
  abortAll(): void;
  /**
   * begin → act → commit, the `runFoldedFigureAction` shape. Resolves undefined
   * without running `act` when the bracket is held by another owner.
   */
  run<T>(owner: string, label: string, act: () => T | Promise<T>): Promise<T | undefined>;
  /** Whether `token` is still the open one — `update` callers check it. */
  isOpen(token: GestureToken): boolean;
  /** Stable snapshot for `useSyncExternalStore`. */
  openOwner(): string | null;
  subscribe(listener: () => void): () => void;
}

export interface GestureBracketSpec<S> {
  layer: string;
  /** Reads the layer's current state from the store. */
  snapshot(): S;
  /** Identity for a plain list; a structural compare where a list is rebuilt per write. */
  unchanged(before: S, now: S): boolean;
  /** Push the history entry: the store's `record*History` action for the layer. */
  record(before: S, label: string): void;
  /** Awaited before the record — the folded layer drains its in-flight kernel writes. */
  beforeCommit?(): Promise<void>;
}

let drainingCount = 0;
const drainingListeners = new Set<() => void>();

/** True while any bracket's `beforeCommit` is in flight. */
export function anyGestureDraining(): boolean {
  return drainingCount > 0;
}

export function subscribeGestureDraining(listener: () => void): () => void {
  drainingListeners.add(listener);
  return () => {
    drainingListeners.delete(listener);
  };
}

function setDraining(delta: 1 | -1): void {
  drainingCount += delta;
  for (const listener of [...drainingListeners]) listener();
}

export function createGestureBracket<S>(spec: GestureBracketSpec<S>): GestureBracket {
  let open: { token: GestureToken; before: S; draining: boolean } | null = null;
  let seq = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const bracket: GestureBracket = {
    begin(owner) {
      if (open) {
        return open.token.owner === owner && !open.draining ? open.token : null;
      }
      if (anyGestureDraining()) return null;
      seq += 1;
      const token: GestureToken = { layer: spec.layer, owner, seq };
      open = { token, before: spec.snapshot(), draining: false };
      notify();
      return token;
    },
    async commit(token, label) {
      if (!open || open.token !== token || open.draining) return;
      if (spec.beforeCommit) {
        open.draining = true;
        setDraining(1);
        try {
          await spec.beforeCommit();
        } finally {
          setDraining(-1);
        }
        // Aborted underneath us — an undo landed while the kernel was answering.
        if (!open || open.token !== token) return;
      }
      const before = open.before;
      open = null;
      notify();
      if (!spec.unchanged(before, spec.snapshot())) spec.record(before, label);
    },
    abort(token) {
      if (!open || open.token !== token) return;
      open = null;
      notify();
    },
    abortAll() {
      if (!open) return;
      open = null;
      notify();
    },
    async run(owner, label, act) {
      const token = bracket.begin(owner);
      if (!token) return undefined;
      try {
        return await act();
      } finally {
        await bracket.commit(token, label);
      }
    },
    isOpen(token) {
      return open?.token === token;
    },
    openOwner() {
      return open?.token.owner ?? null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  // Both reasons drop whatever is open: a session that wanted to *commit* on
  // 'history' registers in the earlier phase and has already done so.
  registerCanvasSessionEnder(() => bracket.abortAll(), 'bracket');

  return bracket;
}

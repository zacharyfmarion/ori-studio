import {
  emptySnapshotHistory,
  recordSnapshot,
  redoSnapshot,
  snapshotEntry,
  undoSnapshot,
  type SnapshotHistory,
} from './snapshotHistory';

/**
 * The undo kit of a project-level document — the Diagram's, and Fold's
 * sequences: a document the project holds beside its designs and its crease
 * pattern, snapshotted whole onto a stack of its own (`snapshotHistory`) and
 * replaced whole when the project is.
 *
 * It holds the rules every such document keeps, so that none can forget one:
 *
 * - nothing changes a read-only document (one a newer build wrote), for a
 *   document that is read-only as a whole, nor one that is busy;
 * - an edit that returns the document it was given changed nothing, and
 *   records nothing — not even the document a first edit would have created;
 * - every other edit records the document as it was, trims the history, and
 *   marks the project dirty, or `extend`s the newest entry instead, which is
 *   how a sitting at one field is one undo step ({@link ProjectDocumentHistory.session});
 * - undo and redo restore a whole snapshot;
 * - an install starts from the document's discarded state and an empty history.
 *
 * What a document does on top of those — the Diagram settling its frames and
 * letting go of the assets nothing refers to — it passes in as hooks.
 */
export interface ProjectDocumentHistory<T, D> {
  commit: ProjectDocumentCommit<D>;
  /**
   * Whether an edit in `session` at `key` extends the newest entry, and the
   * session to remember once it has landed. A session only ever extends the
   * entry it made itself: any other recorded edit, an undo, a redo, an install
   * or a replaced document ends it.
   */
  session: (key: string, session: number | undefined) => { extend: boolean; remember: () => void };
  /** Undo or redo one entry. False when there is none, or the document is read-only. */
  travel: (direction: 'undo' | 'redo') => boolean;
  /**
   * Replace the document: everything scoped to it discarded, then `patch` —
   * the document read from a file, or none — over an empty history.
   */
  install: (patch: Partial<T>) => void;
}

/**
 * Apply one edit. Returns the document as it landed, or `null` when nothing
 * changed or the document is read-only.
 */
export type ProjectDocumentCommit<D> = (
  label: string,
  edit: (document: D) => D,
  /** Fold the edit into the newest undo entry instead of recording one. */
  extend?: boolean
) => D | null;

/** The keys of `T` whose values are exactly `V`. */
type KeysHolding<T, V> = {
  [K in keyof T]-?: [T[K]] extends [V] ? ([V] extends [T[K]] ? K : never) : never;
}[keyof T];

/** Where the store keeps a document `S` and the state the kit reads beside it. */
export interface ProjectDocumentKeys<T, S> {
  /** The document as stored: what is snapshotted and restored. */
  document: KeysHolding<T, S>;
  history: KeysHolding<T, SnapshotHistory<S>>;
  /**
   * The document came from a newer build: shown, never changed. None for a
   * document whose parts are read-only each on its own — Fold's sequences,
   * one `formatVersion` apiece — whose edits leave such a part as it is.
   */
  readOnly?: KeysHolding<T, boolean>;
  /** Bumped on every replacement, so a session never outlives its document. */
  loadId: KeysHolding<T, number>;
}

/** What an edit lands as: the document to store, and anything to set with it. */
export interface ProjectDocumentLanding<T, S, D> {
  document: D;
  /** Set with the edit, given the history it landed in. */
  alongside?: (history: SnapshotHistory<S>) => Partial<T>;
}

export interface ProjectDocumentHistoryOptions<T extends { dirty: boolean }, S, D extends S> {
  get: () => T;
  set: (patch: Partial<T>) => void;
  keys: ProjectDocumentKeys<T, S>;
  /**
   * What an edit is given: the stored document, or — for one stored as `null`
   * until its first edit — the document that edit creates.
   */
  base: (stored: S) => D;
  /** Everything scoped to the document as a replacement leaves it: what an install starts from. */
  discard: () => Partial<T>;
  /**
   * Whether edits wait — the document is being written by work of its own,
   * as the Diagram's batch import writes it — so a commit or a travel changes
   * nothing meanwhile, as in a read-only document.
   */
  busy?: (state: T) => boolean;
  /**
   * Land work held in a pause that is newer than anything the history holds
   * — the Pages view's keyboard nudge — before a commit, a session or a
   * travel reads the newest entry, so it comes first, in an undo step of its
   * own.
   */
  flush?: () => void;
  /**
   * A step every edit that changed something passes through before it lands,
   * given the document the edit started from, what it made of it, and the
   * document as stored before it (`null` before a first edit created it).
   */
  beforeCommit?: (base: D, edited: D, before: S) => ProjectDocumentLanding<T, S, D>;
  /** Drop what the history should not keep, after an edit records an entry. */
  trim?: (history: SnapshotHistory<S>, current: D) => SnapshotHistory<S>;
  /**
   * The view state an undo or a redo brings into line with what it restores,
   * set with it: given the document it replaced, and which way it went.
   */
  reconcile?: (restored: S, change: ProjectDocumentTravel<S>) => Partial<T>;
}

/** What an undo or a redo replaced, for {@link ProjectDocumentHistoryOptions.reconcile}. */
export interface ProjectDocumentTravel<S> {
  /** The document as it stood before the travel. */
  before: S;
  direction: 'undo' | 'redo';
}

export function createProjectDocumentHistory<T extends { dirty: boolean }, S, D extends S>(
  options: ProjectDocumentHistoryOptions<T, S, D>
): ProjectDocumentHistory<T, D> {
  const { get, set, keys } = options;

  // The keys are checked against `T` where they are named, so these reads and
  // the write below are what that check proved; TypeScript cannot follow it
  // through a generic index.
  const stored = (state: T) => state[keys.document] as S;
  const history = (state: T) => state[keys.history] as SnapshotHistory<S>;
  const readOnly = (state: T) => (keys.readOnly === undefined ? false : (state[keys.readOnly] as boolean));
  const frozen = (state: T) => readOnly(state) || (options.busy?.(state) ?? false);
  const loadId = (state: T) => state[keys.loadId] as number;
  const landed = (document: S, nextHistory: SnapshotHistory<S>) =>
    ({ [keys.document]: document, [keys.history]: nextHistory, dirty: true }) as Partial<T>;

  /**
   * The edit session whose undo entry is the newest one, if any: a sitting at
   * one field, which `key` names. Every other recorded edit, undo, redo and
   * install clears it.
   */
  let openSession: { key: string; session: number; loadId: number } | null = null;

  const commit: ProjectDocumentCommit<D> = (label, edit, extend = false) => {
    options.flush?.();
    const state = get();
    if (frozen(state)) return null;
    const before = stored(state);
    const base = options.base(before);
    const edited = edit(base);
    // An edit that changed nothing records nothing — and does not bring a
    // document into being just to leave it empty.
    if (edited === base) return null;
    const landing = options.beforeCommit?.(base, edited, before) ?? { document: edited };
    const next = landing.document;
    if (!extend) openSession = null;
    const recorded = extend
      ? history(state)
      : recordSnapshot(history(state), snapshotEntry(before, label));
    const nextHistory = extend || !options.trim ? recorded : options.trim(recorded, next);
    set({ ...landed(next, nextHistory), ...landing.alongside?.(nextHistory) });
    return next;
  };

  const session: ProjectDocumentHistory<T, D>['session'] = (key, sitting) => {
    // Before the newest entry is read: work in its pause is newer.
    options.flush?.();
    const current = loadId(get());
    const extend =
      sitting !== undefined &&
      openSession !== null &&
      openSession.key === key &&
      openSession.session === sitting &&
      openSession.loadId === current;
    return {
      extend,
      remember: () => {
        openSession = sitting === undefined ? null : { key, session: sitting, loadId: current };
      },
    };
  };

  const travel = (direction: 'undo' | 'redo'): boolean => {
    // An undo takes back work in its pause as it would work committed.
    options.flush?.();
    const state = get();
    if (frozen(state)) return false;
    openSession = null;
    const before = stored(state);
    const current = snapshotEntry(before, direction);
    const result =
      direction === 'undo'
        ? undoSnapshot(history(state), current)
        : redoSnapshot(history(state), current);
    if (!result) return false;
    const restored = result.restore.snapshot;
    set({ ...landed(restored, result.history), ...options.reconcile?.(restored, { before, direction }) });
    return true;
  };

  const install = (patch: Partial<T>) => {
    openSession = null;
    set({
      ...options.discard(),
      ...patch,
      [keys.history]: emptySnapshotHistory<S>(),
    });
  };

  return { commit, session, travel, install };
}

/**
 * A sequence of load ids: every replacement of a document takes the next, so
 * work started against one — an async capture, a pending text edit — can tell
 * it has been replaced before it writes into its successor.
 */
export function loadIdSequence(): () => number {
  let last = 0;
  return () => {
    last += 1;
    return last;
  };
}

/** The values of `keys` as they stand, to put back with one `set`. */
export function pickScopedState<T, K extends keyof T>(state: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<T, K>;
}

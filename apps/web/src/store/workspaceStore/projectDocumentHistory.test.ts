import { describe, expect, it, vi } from 'vitest';
import {
  createProjectDocumentHistory,
  loadIdSequence,
  pickScopedState,
  type ProjectDocumentHistoryOptions,
} from './projectDocumentHistory';
import { emptySnapshotHistory, type SnapshotHistory } from './snapshotHistory';

interface Doc {
  value: number;
}

/** A store holding one project document, as the workspace store holds the diagram. */
interface State {
  doc: Doc | null;
  docHistory: SnapshotHistory<Doc | null>;
  docReadOnly: boolean;
  docLoadId: number;
  docSelected: number | null;
  docRaw: string | null;
  dirty: boolean;
}

const nextLoadId = loadIdSequence();

const discard = (): Omit<State, 'dirty'> => ({
  doc: null,
  docHistory: emptySnapshotHistory(),
  docReadOnly: false,
  docLoadId: nextLoadId(),
  docSelected: null,
  docRaw: null,
});

function harness(extra: Partial<ProjectDocumentHistoryOptions<State, Doc | null, Doc>> = {}) {
  let state: State = { ...discard(), dirty: false };
  const set = vi.fn((patch: Partial<State>) => {
    state = { ...state, ...patch };
  });
  const kit = createProjectDocumentHistory<State, Doc | null, Doc>({
    get: () => state,
    set,
    keys: { document: 'doc', history: 'docHistory', readOnly: 'docReadOnly', loadId: 'docLoadId' },
    base: (stored) => stored ?? { value: 0 },
    discard,
    ...extra,
  });
  const add = (amount: number, extend?: boolean) =>
    kit.commit('Add', (doc) => ({ value: doc.value + amount }), extend);
  return { kit, set, add, state: () => state, put: (patch: Partial<State>) => (state = { ...state, ...patch }) };
}

describe('createProjectDocumentHistory', () => {
  it('creates the document with its first edit, and undoing that edit removes it again', () => {
    const { kit, add, state } = harness();

    expect(add(2)).toEqual({ value: 2 });
    expect(state()).toMatchObject({ doc: { value: 2 }, dirty: true });
    expect(state().docHistory.past.map((entry) => entry.snapshot)).toEqual([null]);

    expect(kit.travel('undo')).toBe(true);
    expect(state().doc).toBeNull();
    expect(kit.travel('redo')).toBe(true);
    expect(state().doc).toEqual({ value: 2 });
    expect(kit.travel('redo')).toBe(false);
  });

  it('records nothing for an edit that returns what it was given, and creates nothing for one', () => {
    const { kit, set, state } = harness();

    expect(kit.commit('Nothing', (doc) => doc)).toBeNull();

    expect(set).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ doc: null, dirty: false });
    expect(state().docHistory.past).toEqual([]);
  });

  it('changes nothing in a read-only document, and travels nowhere in its history', () => {
    const { kit, set, add, put } = harness();
    add(1);
    put({ docReadOnly: true });
    set.mockClear();

    expect(add(1)).toBeNull();
    expect(kit.travel('undo')).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it('folds an extended edit into the newest entry, untrimmed', () => {
    const trim = vi.fn((history: SnapshotHistory<Doc | null>) => history);
    const { add, state } = harness({ trim });
    add(1);
    add(1);
    trim.mockClear();

    expect(add(5, true)).toEqual({ value: 7 });

    expect(state().docHistory.past.map((entry) => entry.snapshot)).toEqual([null, { value: 1 }]);
    expect(trim).not.toHaveBeenCalled();
  });

  it('trims the history an edit records, against the document it landed', () => {
    const trim = vi.fn((history: SnapshotHistory<Doc | null>) => ({ ...history, past: history.past.slice(-1) }));
    const { add, state } = harness({ trim });
    add(1);
    add(1);

    expect(trim).toHaveBeenLastCalledWith(expect.objectContaining({ future: [] }), { value: 2 });
    expect(state().docHistory.past.map((entry) => entry.snapshot)).toEqual([{ value: 1 }]);
  });

  it('lands what the document’s own step makes of an edit, with what it sets beside it', () => {
    const beforeCommit = vi.fn((base: Doc, edited: Doc) => ({
      document: { value: edited.value * 10 },
      alongside: (history: SnapshotHistory<Doc | null>) => ({ docSelected: history.past.length + base.value }),
    }));
    const { add, state } = harness({ beforeCommit });

    expect(add(1)).toEqual({ value: 10 });

    // Given the base the edit started from — the created one — and, last, the stored `null` it replaces.
    expect(beforeCommit).toHaveBeenCalledWith({ value: 0 }, { value: 1 }, null);
    expect(state()).toMatchObject({ doc: { value: 10 }, docSelected: 1 });
  });

  it('changes nothing and travels nowhere while the document is busy', () => {
    let busy = false;
    const { kit, set, add } = harness({ busy: () => busy });
    add(1);
    busy = true;
    set.mockClear();

    expect(add(1)).toBeNull();
    expect(kit.travel('undo')).toBe(false);
    expect(set).not.toHaveBeenCalled();

    busy = false;
    expect(kit.travel('undo')).toBe(true);
  });

  it('flushes held work before a commit, a session and a travel read the history', () => {
    const flush = vi.fn();
    const { kit, add } = harness({ flush });

    add(1);
    expect(flush).toHaveBeenCalledTimes(1);
    kit.session('field', 1);
    expect(flush).toHaveBeenCalledTimes(2);
    kit.travel('undo');
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it('brings view state into line with what an undo or a redo restores, in the same set', () => {
    const reconcile = vi.fn((restored: Doc | null) => ({ docSelected: restored?.value ?? null }));
    const { kit, set, add, state } = harness({ reconcile });
    add(3);
    set.mockClear();

    kit.travel('undo');

    expect(set).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ doc: null, docSelected: null, dirty: true });
    kit.travel('redo');
    expect(state().docSelected).toBe(3);
  });

  it('tells the reconcile what the travel replaced, and which way it went', () => {
    const reconcile = vi.fn(() => ({}));
    const { kit, add } = harness({ reconcile });
    add(3);
    add(4);

    kit.travel('undo');
    expect(reconcile).toHaveBeenLastCalledWith({ value: 3 }, { before: { value: 7 }, direction: 'undo' });
    kit.travel('redo');
    expect(reconcile).toHaveBeenLastCalledWith({ value: 7 }, { before: { value: 3 }, direction: 'redo' });
  });

  it('never refuses a document with no read-only field as a whole: its own edits guard its parts', () => {
    let state: State = { ...discard(), docReadOnly: true, dirty: false };
    const kit = createProjectDocumentHistory<State, Doc | null, Doc>({
      get: () => state,
      set: (patch) => (state = { ...state, ...patch }),
      keys: { document: 'doc', history: 'docHistory', loadId: 'docLoadId' },
      base: (stored) => stored ?? { value: 0 },
      discard,
    });

    // The field is there, but the kit was not told to read it.
    expect(kit.commit('Add', (doc) => ({ value: doc.value + 1 }))).toEqual({ value: 1 });
    expect(kit.travel('undo')).toBe(true);
    expect(state.doc).toBeNull();
  });

  describe('a session', () => {
    it('extends only the entry it made itself', () => {
      const { kit, add, state } = harness();
      const sit = (key: string, session?: number) => {
        const { extend, remember } = kit.session(key, session);
        if (add(1, extend)) remember();
      };

      sit('text', 7);
      sit('text', 7);
      sit('text', 7);
      expect(state().docHistory.past).toHaveLength(1);
      // Another field, another session, or none: an entry of its own.
      sit('label', 7);
      sit('label', 8);
      sit('label');
      sit('label');
      expect(state().docHistory.past).toHaveLength(5);
    });

    it('ends with any other edit, an undo, a redo or an install', () => {
      const { kit, add } = harness();
      const open = () => kit.session('text', 1).remember();

      open();
      add(1);
      expect(kit.session('text', 1).extend).toBe(false);
      open();
      kit.travel('undo');
      expect(kit.session('text', 1).extend).toBe(false);
      open();
      kit.travel('redo');
      expect(kit.session('text', 1).extend).toBe(false);
      open();
      expect(kit.session('text', 1).extend).toBe(true);
      kit.install({});
      expect(kit.session('text', 1).extend).toBe(false);
    });

    it('does not outlive the document it began on', () => {
      const { kit, put } = harness();
      kit.session('text', 1).remember();

      put({ docLoadId: nextLoadId() });

      expect(kit.session('text', 1).extend).toBe(false);
    });
  });

  it('installs over the discarded state, with an empty history', () => {
    const { kit, add, state } = harness();
    add(1);
    const loadId = state().docLoadId;
    kit.install({ doc: { value: 9 }, docReadOnly: true, docRaw: 'as read' });

    expect(state()).toMatchObject({ doc: { value: 9 }, docReadOnly: true, docRaw: 'as read' });
    expect(state().docHistory).toEqual(emptySnapshotHistory());
    expect(state().docLoadId).not.toBe(loadId);
  });

  it('names its fields by keys that hold the right type', () => {
    // Checked by the type checker; never run.
    const typed = (options: ProjectDocumentHistoryOptions<State, Doc | null, Doc>) => [
      // @ts-expect-error -- a field that does not hold the document
      createProjectDocumentHistory<State, Doc | null, Doc>({ ...options, keys: { ...options.keys, document: 'docRaw' } }),
      // @ts-expect-error -- a field that is not a boolean
      createProjectDocumentHistory<State, Doc | null, Doc>({ ...options, keys: { ...options.keys, readOnly: 'docLoadId' } }),
    ];
    expect(typed).toBeTypeOf('function');
  });
});

describe('loadIdSequence', () => {
  it('counts up, and on its own', () => {
    const first = loadIdSequence();
    const second = loadIdSequence();
    expect([first(), first(), second()]).toEqual([1, 2, 1]);
  });
});

describe('pickScopedState', () => {
  it('takes the named fields as they stand', () => {
    expect(pickScopedState({ a: 1, b: 2, c: 3 }, ['a', 'c'] as const)).toEqual({ a: 1, c: 3 });
  });
});

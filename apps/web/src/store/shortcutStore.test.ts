import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getResolvedShortcuts } from '../keyboard/shortcuts';
import { registerCpActionShortcutExecutor } from '../keyboard/shortcutRuntime';
import { installAppKeyboardListener } from '../lib/appKeyboard';
import type { Selection } from '../lib/sampleProject';
import { SHORTCUT_STORAGE_KEY, useShortcutStore } from './shortcutStore';

const initialState = useShortcutStore.getInitialState();

beforeEach(() => {
  localStorage.clear();
  useShortcutStore.setState(initialState, true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('shortcutStore', () => {
  it('persists overrides and disabled shortcuts', () => {
    useShortcutStore.getState().setShortcut('file.save', { primary: true, alt: true, key: 's' });
    useShortcutStore.getState().clearShortcut('cp.action.line-type.mountain');

    expect(useShortcutStore.getState().overrides['file.save']).toEqual([
      {
        primary: true,
        alt: true,
        key: 's',
      },
    ]);
    expect(useShortcutStore.getState().overrides['cp.action.line-type.mountain']).toBeNull();

    const stored = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}') as {
      bindings?: Record<string, unknown>;
    };
    expect(stored.bindings?.['file.save']).toEqual([{ primary: true, alt: true, key: 's' }]);
    expect(stored.bindings?.['cp.action.line-type.mountain']).toBeNull();
  });

  it('resets individual shortcuts and all shortcuts', () => {
    useShortcutStore.getState().setShortcut('file.save', { primary: true, alt: true, key: 's' });
    useShortcutStore.getState().resetShortcut('file.save');

    expect(useShortcutStore.getState().overrides['file.save']).toBeUndefined();

    useShortcutStore.getState().setShortcut('file.open', { primary: true, alt: true, key: 'o' });
    useShortcutStore.getState().resetAllShortcuts();

    expect(useShortcutStore.getState().overrides).toEqual({});
  });

  it('keeps protected undo defaults when clearing custom bindings', () => {
    useShortcutStore.getState().setShortcut('edit.undo', {
      primary: true,
      alt: true,
      key: 'z',
    });
    expect(getResolvedShortcuts('edit.undo', useShortcutStore.getState().overrides)).toEqual([
      { primary: true, key: 'z' },
      { primary: true, alt: true, key: 'z' },
    ]);

    useShortcutStore.getState().clearShortcut('edit.undo');

    expect(useShortcutStore.getState().overrides['edit.undo']).toBeUndefined();
    expect(getResolvedShortcuts('edit.undo', useShortcutStore.getState().overrides)).toEqual([
      { primary: true, key: 'z' },
    ]);
  });

  describe('defaultsSource', () => {
    it('reads a version 1 payload as the Ori Studio layout and rewrites it as version 2', async () => {
      localStorage.setItem(
        SHORTCUT_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          bindings: { 'file.save': [{ primary: true, alt: true, key: 's' }] },
        }),
      );

      vi.resetModules();
      const reloaded = await import('./shortcutStore');

      expect(reloaded.useShortcutStore.getState().defaultsSource).toBe('ori-studio');
      expect(reloaded.useShortcutStore.getState().overrides['file.save']).toEqual([
        { primary: true, alt: true, key: 's' },
      ]);

      reloaded.useShortcutStore.getState().setDefaultsSource('oriedita');

      const stored = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}') as {
        version?: number;
        defaultsSource?: string;
        bindings?: Record<string, unknown>;
      };
      expect(stored.version).toBe(2);
      expect(stored.defaultsSource).toBe('oriedita');
      expect(stored.bindings?.['file.save']).toEqual([{ primary: true, alt: true, key: 's' }]);
    });

    // The store is built while the module body runs, so a payload it cannot read
    // has to fall back rather than throw: anything escaping `loadShortcutState`
    // takes the whole app down instead of costing one preference.
    it.each([
      ['a literal null', 'null'],
      ['a non-object', '"oriedita"'],
      ['unparseable JSON', '{oops'],
    ])('falls back to the Ori Studio layout for %s payload', async (_label, raw) => {
      localStorage.setItem(SHORTCUT_STORAGE_KEY, raw);

      vi.resetModules();
      const reloaded = await import('./shortcutStore');

      expect(reloaded.useShortcutStore.getState().defaultsSource).toBe('ori-studio');
      expect(reloaded.useShortcutStore.getState().overrides).toEqual({});
    });

    it('reads an unrecognized source as the Ori Studio layout', async () => {
      localStorage.setItem(
        SHORTCUT_STORAGE_KEY,
        JSON.stringify({ version: 2, bindings: {}, defaultsSource: 'emacs' }),
      );

      vi.resetModules();
      const reloaded = await import('./shortcutStore');

      expect(reloaded.useShortcutStore.getState().defaultsSource).toBe('ori-studio');
    });

    it('round-trips the source through a reload', async () => {
      useShortcutStore.getState().setDefaultsSource('oriedita');

      vi.resetModules();
      const reloaded = await import('./shortcutStore');

      expect(reloaded.useShortcutStore.getState().defaultsSource).toBe('oriedita');
    });

    it('leaves overrides alone when the source switches', () => {
      useShortcutStore.getState().setShortcut('cp.action.line-type.valley', { key: 'q' });
      useShortcutStore.getState().setDefaultsSource('oriedita');

      const { overrides, defaultsSource } = useShortcutStore.getState();
      expect(overrides['cp.action.line-type.valley']).toEqual([{ key: 'q' }]);
      expect(
        getResolvedShortcuts('cp.action.line-type.valley', { overrides, defaultsSource }),
      ).toEqual([{ key: 'q' }]);
      // An unoverridden action does move with the source.
      expect(
        getResolvedShortcuts('cp.action.line-type.mountain', { overrides, defaultsSource }),
      ).toEqual([{ key: 'm' }]);
    });

    it('does not persist or notify when the source is unchanged', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      useShortcutStore.getState().setDefaultsSource('ori-studio');

      expect(setItem.mock.calls.filter(([key]) => key === SHORTCUT_STORAGE_KEY)).toHaveLength(0);
    });

    it('resets a row and all rows to the active source', () => {
      useShortcutStore.getState().setDefaultsSource('oriedita');
      useShortcutStore.getState().setShortcut('cp.action.line-type.mountain', { key: 'q' });
      useShortcutStore.getState().resetShortcut('cp.action.line-type.mountain');

      let { overrides, defaultsSource } = useShortcutStore.getState();
      expect(defaultsSource).toBe('oriedita');
      expect(
        getResolvedShortcuts('cp.action.line-type.mountain', { overrides, defaultsSource }),
      ).toEqual([{ key: 'm' }]);

      useShortcutStore.getState().setShortcut('cp.action.line-type.valley', { key: 'q' });
      useShortcutStore.getState().resetAllShortcuts();

      ({ overrides, defaultsSource } = useShortcutStore.getState());
      expect(defaultsSource).toBe('oriedita');
      expect(overrides).toEqual({});
      expect(
        getResolvedShortcuts('cp.action.line-type.valley', { overrides, defaultsSource }),
      ).toEqual([{ key: 'v' }]);
    });

    it('keeps the source when other shortcut edits persist', async () => {
      useShortcutStore.getState().setDefaultsSource('oriedita');
      useShortcutStore.getState().setShortcut('file.save', { primary: true, alt: true, key: 's' });
      useShortcutStore.getState().clearShortcut('cp.action.line-type.edge');
      useShortcutStore.getState().applyImportedShortcuts({ 'file.open': [{ key: 'o' }] });

      vi.resetModules();
      const reloaded = await import('./shortcutStore');

      expect(reloaded.useShortcutStore.getState().defaultsSource).toBe('oriedita');
    });
  });

  // What this covers that a dispatcher test cannot: the source a *returning*
  // user gets is the one read back out of storage, and it has to survive all the
  // way to a keypress. If it does not, M keeps firing Symmetric Draw — the wrong
  // action, silently — while the Settings list shows Oriedita's layout.
  describe('reaching the real keyboard path', () => {
    it('dispatches M to Mountain when the Oriedita layout was persisted', async () => {
      localStorage.setItem(
        SHORTCUT_STORAGE_KEY,
        JSON.stringify({ version: 2, bindings: {}, defaultsSource: 'oriedita' }),
      );
      vi.resetModules();
      const { useShortcutStore } = await import('./shortcutStore');

      const fired: string[] = [];
      const disposeExecutor = registerCpActionShortcutExecutor((id) => {
        fired.push(id);
        return true;
      });
      const dispose = installAppKeyboardListener(
        {
          getActiveEditingContext: () => 'crease-pattern',
          getSelection: () => ({ kind: 'tree' }) as Selection,
          handleMenuAction: () => undefined,
          selectNone: () => undefined,
          getShortcutOverrides: () => useShortcutStore.getState().overrides,
          getShortcutDefaultsSource: () => useShortcutStore.getState().defaultsSource,
        },
        document,
      );

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));

      dispose();
      disposeExecutor();
      expect(fired).toEqual(['cp.action.line-type.mountain']);
    });
  });

  describe('assignShortcut', () => {
    it('writes the binding and its unbinds in a single storage write', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      let notifications = 0;
      const unsubscribe = useShortcutStore.subscribe(() => {
        notifications += 1;
      });

      useShortcutStore
        .getState()
        .assignShortcut(
          'cp.action.line-type.mountain',
          { key: 'm' },
          { unbind: ['cp.action.symmetric-draw'] },
        );
      unsubscribe();

      const shortcutWrites = setItem.mock.calls.filter(([key]) => key === SHORTCUT_STORAGE_KEY);
      expect(shortcutWrites).toHaveLength(1);
      // One notification too: a subscriber that sees the unbind and the claim as
      // two states sees a moment where the chord answers to nobody.
      expect(notifications).toBe(1);

      const { overrides } = useShortcutStore.getState();
      expect(overrides['cp.action.line-type.mountain']).toEqual([{ key: 'm' }]);
      expect(overrides['cp.action.symmetric-draw']).toBeNull();
      expect(getResolvedShortcuts('cp.action.line-type.mountain', overrides)).toEqual([
        { key: 'm' },
      ]);
      expect(getResolvedShortcuts('cp.action.symmetric-draw', overrides)).toEqual([]);
    });

    it('persists both halves of the assignment', () => {
      useShortcutStore
        .getState()
        .assignShortcut(
          'cp.action.line-type.mountain',
          { key: 'm' },
          { unbind: ['cp.action.symmetric-draw'] },
        );

      const stored = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}') as {
        bindings?: Record<string, unknown>;
      };
      expect(stored.bindings?.['cp.action.line-type.mountain']).toEqual([{ key: 'm' }]);
      expect(stored.bindings?.['cp.action.symmetric-draw']).toBeNull();
    });

    it('assigns without unbinding anything when nothing is displaced', () => {
      useShortcutStore.getState().assignShortcut('cp.action.line-type.mountain', { key: 'k' });

      const { overrides } = useShortcutStore.getState();
      expect(Object.keys(overrides)).toEqual(['cp.action.line-type.mountain']);
      expect(overrides['cp.action.line-type.mountain']).toEqual([{ key: 'k' }]);
    });

    // Undo and Redo merge their override with the defaults rather than replacing
    // them, so a null would not unbind them — and deleting an existing override
    // would throw the user's extra chord away while still changing nothing.
    it('never unbinds a shortcut that keeps its defaults', () => {
      useShortcutStore.getState().setShortcut('edit.undo', { primary: true, alt: true, key: 'z' });

      useShortcutStore.getState().assignShortcut(
        'cp.action.line-type.mountain',
        { primary: true, key: 'z' },
        {
          unbind: ['edit.undo'],
        },
      );

      const { overrides } = useShortcutStore.getState();
      expect(overrides['edit.undo']).toEqual([{ primary: true, alt: true, key: 'z' }]);
      expect(getResolvedShortcuts('edit.undo', overrides)).toContainEqual({
        primary: true,
        key: 'z',
      });
    });

    it('honours the assignment when an id names itself as displaced', () => {
      useShortcutStore.getState().assignShortcut(
        'cp.action.line-type.mountain',
        { key: 'm' },
        {
          unbind: ['cp.action.line-type.mountain'],
        },
      );

      expect(useShortcutStore.getState().overrides['cp.action.line-type.mountain']).toEqual([
        { key: 'm' },
      ]);
    });

    it('keeps the active source', () => {
      useShortcutStore.getState().setDefaultsSource('oriedita');
      useShortcutStore.getState().assignShortcut('cp.action.line-type.mountain', { key: 'k' });

      expect(useShortcutStore.getState().defaultsSource).toBe('oriedita');
    });
  });

  describe('applyImportedShortcuts', () => {
    it('persists the whole import with a single storage write', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      useShortcutStore.getState().applyImportedShortcuts({
        'file.save': [{ primary: true, key: 's' }],
        'file.open': [{ primary: true, key: 'o' }],
        'cp.action.line-type.mountain': [{ key: 'm' }],
      });

      const shortcutWrites = setItem.mock.calls.filter(([key]) => key === SHORTCUT_STORAGE_KEY);
      expect(shortcutWrites).toHaveLength(1);

      const stored = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}') as {
        bindings?: Record<string, unknown>;
      };
      expect(stored.bindings?.['file.save']).toEqual([{ primary: true, key: 's' }]);
      expect(stored.bindings?.['cp.action.line-type.mountain']).toEqual([{ key: 'm' }]);
    });

    it('merges over existing overrides instead of replacing them', () => {
      useShortcutStore.getState().setShortcut('file.save', { primary: true, alt: true, key: 's' });

      useShortcutStore.getState().applyImportedShortcuts({
        'file.open': [{ primary: true, key: 'o' }],
      });

      expect(useShortcutStore.getState().overrides['file.save']).toEqual([
        { primary: true, alt: true, key: 's' },
      ]);
      expect(useShortcutStore.getState().overrides['file.open']).toEqual([
        { primary: true, key: 'o' },
      ]);
    });

    it('keeps protected undo and redo defaults when an import unbinds them', () => {
      useShortcutStore.getState().setShortcut('edit.undo', { primary: true, alt: true, key: 'z' });
      useShortcutStore.getState().setShortcut('edit.redo', { primary: true, alt: true, key: 'y' });

      useShortcutStore.getState().applyImportedShortcuts({ 'edit.undo': null, 'edit.redo': null });

      const { overrides } = useShortcutStore.getState();
      expect(overrides['edit.undo']).toBeUndefined();
      expect(overrides['edit.redo']).toBeUndefined();
      expect(getResolvedShortcuts('edit.undo', overrides)).toEqual([{ primary: true, key: 'z' }]);
      expect(getResolvedShortcuts('edit.redo', overrides).length).toBeGreaterThan(0);
    });

    // The import plan refuses to target undo/redo at all, and this is why: an
    // override on them is *merged* with the defaults rather than replacing them,
    // so no caller can move Undo off its default — only add a second chord.
    it('cannot move undo off its default, only add to it', () => {
      const before = getResolvedShortcuts('edit.undo', {});

      useShortcutStore
        .getState()
        .applyImportedShortcuts({ 'edit.undo': [{ primary: true, key: 'q' }] });

      const after = getResolvedShortcuts('edit.undo', useShortcutStore.getState().overrides);
      for (const chord of before) expect(after).toContainEqual(chord);
      expect(after).toContainEqual({ primary: true, key: 'q' });
    });

    // The import plan never emits null — an empty hotkey value is skipped rather
    // than treated as an unbind — but the store API should still survive one.
    it('round-trips a null override through a reload', async () => {
      useShortcutStore.getState().applyImportedShortcuts({
        'cp.action.line-type.mountain': null,
        'file.save': [{ primary: true, key: 's' }],
      });

      vi.resetModules();
      const reloaded = await import('./shortcutStore');

      expect(reloaded.useShortcutStore.getState().overrides['cp.action.line-type.mountain']).toBe(
        null,
      );
      expect(reloaded.useShortcutStore.getState().overrides['file.save']).toEqual([
        { primary: true, key: 's' },
      ]);
    });
  });
});

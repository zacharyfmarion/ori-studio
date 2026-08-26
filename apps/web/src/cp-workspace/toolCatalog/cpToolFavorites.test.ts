import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';
import { cpActionById } from '../../lib/oristudioCpActions';
import {
  CP_DEFAULT_FAVORITE_ACTION_IDS,
  cpFavoriteToolActions,
  cpToolFavoriteIds,
  isCpToolFavorite,
  moveCpToolFavorite,
  resetCpToolFavorites,
  toggleCpToolFavorite,
} from './cpToolFavorites';

const KEY = storageKey(STORAGE_KEYS.cpToolFavorites);

afterEach(() => {
  resetCpToolFavorites();
});

/**
 * Plant a raw stored value the way a stale release or a hand edit would have,
 * and drop the cache so the next read actually parses it.
 */
function seedRaw(value: string): void {
  resetCpToolFavorites();
  localStorage.setItem(KEY, value);
}

/** Reload, as far as this module is concerned: same storage, cold cache. */
function reload(): void {
  seedRaw(localStorage.getItem(KEY) ?? '');
}

/** The last shipped default, named once rather than asserted with `at(-1)!`. */
const LAST_DEFAULT = CP_DEFAULT_FAVORITE_ACTION_IDS[CP_DEFAULT_FAVORITE_ACTION_IDS.length - 1];

describe('the shipped defaults', () => {
  /*
   * The one that catches a hand-derived id. `DrawCreaseFree`'s action is
   * `cp.action.draw-crease`, not `cp.action.draw-crease-free`, because it is the
   * single command carrying an id override — so kebab-casing the operation name
   * produces a plausible id that resolves to nothing.
   */
  it('every default id resolves against the catalogue', () => {
    for (const id of CP_DEFAULT_FAVORITE_ACTION_IDS) {
      expect(cpActionById(id), id).toBeDefined();
    }
  });

  /*
   * No count asserted. The set is a product decision that has already changed
   * once (plain Line was pulled after the first cut), and a test that pinned the
   * number would have to be edited by whoever changes it — which teaches them to
   * edit tests rather than to think. What must hold is that every entry is a
   * real, shipped, usable tool.
   */
  it('is all real command tools that are ready to use', () => {
    expect(CP_DEFAULT_FAVORITE_ACTION_IDS.length).toBeGreaterThan(0);
    for (const action of cpFavoriteToolActions()) {
      expect(action.kind).toBe('command');
      expect(action.uiStatus).toBe('ready');
    }
  });

  it('holds no duplicates', () => {
    expect(new Set(CP_DEFAULT_FAVORITE_ACTION_IDS).size).toBe(
      CP_DEFAULT_FAVORITE_ACTION_IDS.length
    );
  });
});

describe('an untouched user', () => {
  it('gets the defaults', () => {
    expect(cpToolFavoriteIds()).toEqual(CP_DEFAULT_FAVORITE_ACTION_IDS);
  });

  /*
   * The load-bearing half of "absent means defaults": reading must not write.
   * If a read materialized the list, everyone would be frozen on whatever
   * shipped the day they first opened the sheet.
   */
  it('has nothing persisted, so a later change of defaults still reaches them', () => {
    cpToolFavoriteIds();
    isCpToolFavorite('cp.action.crease-select');
    cpFavoriteToolActions();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('toggling', () => {
  it('appends a new favorite at the end', () => {
    toggleCpToolFavorite('cp.action.square-bisector');
    expect(cpToolFavoriteIds().at(-1)).toBe('cp.action.square-bisector');
    expect(cpToolFavoriteIds()).toHaveLength(CP_DEFAULT_FAVORITE_ACTION_IDS.length + 1);
  });

  it('removes an existing one and leaves the rest in order', () => {
    toggleCpToolFavorite('cp.action.crease-toggle-mv');
    expect(isCpToolFavorite('cp.action.crease-toggle-mv')).toBe(false);
    expect(cpToolFavoriteIds()).toEqual(
      CP_DEFAULT_FAVORITE_ACTION_IDS.filter((id) => id !== 'cp.action.crease-toggle-mv')
    );
  });

  it('materializes the defaults on the first edit', () => {
    toggleCpToolFavorite('cp.action.square-bisector');
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    expect(stored.version).toBe(1);
    expect(stored.ids).toEqual([...CP_DEFAULT_FAVORITE_ACTION_IDS, 'cp.action.square-bisector']);
  });

  /*
   * An empty array is a decision, not an absence. Someone who un-stars every
   * tool must not have the defaults handed back to them on the next reload.
   */
  it('honours an empty list across a reload rather than restoring the defaults', () => {
    for (const id of [...CP_DEFAULT_FAVORITE_ACTION_IDS]) toggleCpToolFavorite(id);
    expect(cpToolFavoriteIds()).toEqual([]);
    reload();
    expect(cpToolFavoriteIds()).toEqual([]);
  });
});

describe('moving', () => {
  it('moves a favorite to the front', () => {
    moveCpToolFavorite(LAST_DEFAULT, 0);
    expect(cpToolFavoriteIds()[0]).toBe(LAST_DEFAULT);
    expect(cpToolFavoriteIds()).toHaveLength(CP_DEFAULT_FAVORITE_ACTION_IDS.length);
  });

  it('preserves every other tool, so a move is a permutation', () => {
    moveCpToolFavorite(CP_DEFAULT_FAVORITE_ACTION_IDS[1], 4);
    expect([...cpToolFavoriteIds()].sort()).toEqual([...CP_DEFAULT_FAVORITE_ACTION_IDS].sort());
  });

  it('clamps an out-of-range index instead of dropping the tool', () => {
    const first = CP_DEFAULT_FAVORITE_ACTION_IDS[0];
    moveCpToolFavorite(first, 99);
    expect(cpToolFavoriteIds().at(-1)).toBe(first);
    moveCpToolFavorite(first, -99);
    expect(cpToolFavoriteIds()[0]).toBe(first);
  });

  /*
   * Fired on every pointer move of a drag, so an unchanged order must not write.
   * A finger held still would otherwise hit localStorage at pointer-event rate.
   */
  it('does not write when the index is unchanged', () => {
    moveCpToolFavorite(CP_DEFAULT_FAVORITE_ACTION_IDS[2], 2);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores a tool that is not favorited', () => {
    moveCpToolFavorite('cp.action.square-bisector', 0);
    expect(cpToolFavoriteIds()).toEqual(CP_DEFAULT_FAVORITE_ACTION_IDS);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('materializes the defaults on a first move, like a first toggle', () => {
    moveCpToolFavorite(CP_DEFAULT_FAVORITE_ACTION_IDS[0], 3);
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null').ids).toEqual(cpToolFavoriteIds());
  });
});

describe('a stored value that cannot be trusted', () => {
  it.each([
    ['not JSON at all', 'not json'],
    ['a bare array from some other shape', '["cp.action.crease-select"]'],
    ['a future version', '{"version":99,"ids":["cp.action.crease-select"]}'],
    ['ids that are not an array', '{"version":1,"ids":"cp.action.crease-select"}'],
    ['null', 'null'],
  ])('falls back to the defaults: %s', (_label, raw) => {
    seedRaw(raw);
    expect(cpToolFavoriteIds()).toEqual(CP_DEFAULT_FAVORITE_ACTION_IDS);
  });

  it('drops non-string entries but keeps the rest', () => {
    seedRaw('{"version":1,"ids":["cp.action.crease-select",42,null,"cp.action.draw-crease"]}');
    expect(cpToolFavoriteIds()).toEqual(['cp.action.crease-select', 'cp.action.draw-crease']);
  });

  /*
   * An id the catalogue no longer knows is dropped at *resolve* time only. It
   * stays in storage, so a tool that is temporarily absent — behind a flag, or
   * renamed and restored — does not permanently delete itself from someone's
   * favorites.
   */
  it('hides an unknown id from the rendered list but keeps it stored', () => {
    seedRaw('{"version":1,"ids":["cp.action.crease-select","cp.action.gone"]}');
    expect(cpFavoriteToolActions().map((action) => action.id)).toEqual([
      'cp.action.crease-select',
    ]);
    expect(cpToolFavoriteIds()).toContain('cp.action.gone');
  });
});

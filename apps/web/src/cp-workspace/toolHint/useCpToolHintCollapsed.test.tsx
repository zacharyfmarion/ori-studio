import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCpToolHintCollapsed } from './useCpToolHintCollapsed';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';

const KEY = storageKey(STORAGE_KEYS.cpToolHintCollapsed);

describe('useCpToolHintCollapsed', () => {
  let host: HTMLElement;
  let root: Root;
  let seen: boolean;
  let set: (collapsed: boolean) => void;

  function Probe() {
    const [collapsed, setCollapsed] = useCpToolHintCollapsed();
    seen = collapsed;
    set = setCollapsed;
    return null;
  }

  const mount = () => act(() => root.render(<Probe />));
  const remount = () => {
    act(() => root.unmount());
    root = createRoot(host);
    mount();
  };

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
  });

  it('starts expanded when nothing is stored', () => {
    mount();
    expect(seen).toBe(false);
  });

  it('restores a stored collapse on mount', () => {
    localStorage.setItem(KEY, 'true');
    mount();
    expect(seen).toBe(true);
  });

  it('survives an unmount/remount cycle', () => {
    // The regression this hook exists for: the window unmounts whenever the
    // active tool has nothing to say, so state that lived in the component
    // sprang back open on the next tool.
    mount();
    act(() => set(true));
    expect(seen).toBe(true);
    remount();
    expect(seen).toBe(true);
  });

  it('reads a corrupt stored value as expanded', () => {
    localStorage.setItem(KEY, '{"collapsed":true}');
    mount();
    expect(seen).toBe(false);
  });

  it('keeps working when storage throws', () => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    Storage.prototype.setItem = () => {
      throw new Error('denied');
    };
    try {
      mount();
      expect(seen).toBe(false);
      act(() => set(true));
      expect(seen).toBe(true);
    } finally {
      Storage.prototype.getItem = getItem;
      Storage.prototype.setItem = setItem;
    }
  });
});

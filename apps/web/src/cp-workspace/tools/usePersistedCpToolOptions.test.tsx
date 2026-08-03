import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistedCpToolOptions } from './usePersistedCpToolOptions';
import { DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS } from '../../lib/oristudioCpToolSettings';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';

const KEY = storageKey(STORAGE_KEYS.cpToolOptions);

describe('usePersistedCpToolOptions', () => {
  let host: HTMLElement;
  let root: Root;
  let set: (update: (current: typeof DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS) => typeof DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS) => void;
  let seen: typeof DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS;

  function Probe() {
    const [options, setOptions] = usePersistedCpToolOptions();
    seen = options;
    set = setOptions;
    return null;
  }

  const mount = () => act(() => root.render(<Probe />));

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.useRealTimers();
  });

  it('starts from the defaults when nothing is stored', () => {
    mount();
    expect(seen).toEqual(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS);
  });

  it('restores a stored value on mount', () => {
    localStorage.setItem(KEY, JSON.stringify({ angleSystemDivider: 16 }));
    mount();
    expect(seen.angleSystemDivider).toBe(16);
  });

  it('writes a change back, once the debounce elapses', () => {
    mount();
    act(() => set((current) => ({ ...current, angleSystemDivider: 16 })));
    act(() => vi.advanceTimersByTime(500));
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').angleSystemDivider).toBe(16);
  });

  it('coalesces a burst into one write, so typing does not write per keystroke', () => {
    mount();
    for (const divider of [1, 12, 16]) {
      act(() => set((current) => ({ ...current, angleSystemDivider: divider })));
      act(() => vi.advanceTimersByTime(50));
    }
    // Nothing yet: each change restarted the timer.
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').angleSystemDivider).toBe(16);
  });

  it('writes only the opted-in keys', () => {
    // The registry decides that, not this hook — asserted here so the seam
    // cannot quietly widen to the whole struct.
    mount();
    act(() => set((current) => ({ ...current, candidateIndex: 3, textContent: 'x' })));
    act(() => vi.advanceTimersByTime(500));
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(raw).not.toHaveProperty('candidateIndex');
    expect(raw).not.toHaveProperty('textContent');
  });
});

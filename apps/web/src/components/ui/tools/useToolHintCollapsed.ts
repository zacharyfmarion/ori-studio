/**
 * Whether the tool hint window is collapsed to just its header.
 *
 * Persisted, and that is the whole reason this is not a `useState`. The window
 * only mounts while a tool with something to say is active, so the state it used
 * to hold died every time the user left the tool: collapsing it lasted until the
 * next tool switch, then it sprang back open. Someone who collapsed it did so
 * because it was in their way, and it kept getting back in their way.
 *
 * One preference for the window, not one per tool. Being in the way is a
 * property of where the window sits, not of which tool put it there — and
 * per-tool state would reintroduce the same surprise, just on a longer cycle.
 *
 * Defaults to expanded. The instructions are the discoverable half of several
 * tools (the three-crease fold-angle solve is unusable without them), so a
 * collapsed first run would trade one discoverability problem for a worse one.
 * `readBoolean` gives that for free: anything but a stored `'true'` reads false.
 */
import { useCallback, useState } from 'react';
import { readBoolean, storageKey, writeBoolean } from '../../../lib/storage';

/**
 * `name` is a `STORAGE_KEYS` entry: one per workspace's window, since each sits
 * over a different surface and is in the way of different things.
 */
export function readToolHintCollapsed(name: string): boolean {
  return readBoolean(storageKey(name), false);
}

export function useToolHintCollapsed(name: string): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() => readToolHintCollapsed(name));

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      writeBoolean(storageKey(name), next);
    },
    [name]
  );

  return [collapsed, setCollapsed];
}

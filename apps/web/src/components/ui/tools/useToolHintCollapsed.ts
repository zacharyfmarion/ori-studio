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
 * A surface whose window would hide what the tool works on can start it
 * collapsed instead (`fallback`): the title bar still names the tool, and a
 * tap opens it. Either way, a choice once made is the one read back.
 */
import { useCallback, useState } from 'react';
import { readBoolean, storageKey, writeBoolean } from '../../../lib/storage';

/**
 * `name` is a `STORAGE_KEYS` entry: one per workspace's window, since each sits
 * over a different surface and is in the way of different things.
 *
 * `fallback` is the state before anyone has chosen: expanded, unless a surface
 * has a reason it should not be — a phone's Fold canvas, where the open window
 * would cover the paper the tool is picking points on.
 */
export function readToolHintCollapsed(name: string, fallback = false): boolean {
  return readBoolean(storageKey(name), fallback);
}

export function useToolHintCollapsed(
  name: string,
  fallback = false
): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() => readToolHintCollapsed(name, fallback));

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      writeBoolean(storageKey(name), next);
    },
    [name]
  );

  return [collapsed, setCollapsed];
}

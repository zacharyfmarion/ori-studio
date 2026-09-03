import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../components/ui/contextMenuTypes';
import { simulatorMenuItems, type SimulatorContextMenuDeps } from './simulatorContextMenu';

const t = ((_key: string, defaultValue?: string) => defaultValue ?? _key) as unknown as TFunction;

const SETTINGS = {
  showFaces: true,
  showEdges: false,
  showHiddenLines: false,
  lighting: true,
};

function deps(overrides: Partial<SimulatorContextMenuDeps> = {}): SimulatorContextMenuDeps {
  return { t, run: vi.fn(), playing: false, settings: SETTINGS, ...overrides };
}

function ids(items: ContextMenuItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'separator'
      ? []
      : item.kind === 'submenu'
        ? item.items.map((child) => ('id' in child ? child.id : ''))
        : [item.id]
  );
}

function find(items: ContextMenuItem[], id: string): ContextMenuItem | undefined {
  for (const item of items) {
    if (item.kind === 'submenu') {
      const nested = item.items.find((child) => 'id' in child && child.id === id);
      if (nested) return nested;
    } else if ('id' in item && item.id === id) return item;
  }
  return undefined;
}

describe('simulatorMenuItems', () => {
  it('names the half of the toggle this press will do', () => {
    const paused = find(simulatorMenuItems(deps({ playing: false })), 'simulator.playPause');
    const playing = find(simulatorMenuItems(deps({ playing: true })), 'simulator.playPause');

    expect(paused && 'label' in paused ? paused.label : null).toBe('Play');
    expect(playing && 'label' in playing ? playing.label : null).toBe('Pause');
  });

  it('shows each row its own chord', () => {
    const replay = find(simulatorMenuItems(deps()), 'simulator.replay');

    // The whole reason this menu exists: the simulator's verbs are keys, and
    // nothing else in the UI says so.
    expect(replay && 'shortcut' in replay ? replay.shortcut : undefined).toBeTruthy();
  });

  it('checks the view toggles against the current settings', () => {
    const items = simulatorMenuItems(deps());

    expect(find(items, 'simulator.toggleFaces')).toMatchObject({ checked: true });
    expect(find(items, 'simulator.toggleCreases')).toMatchObject({ checked: false });
    expect(find(items, 'simulator.toggleLighting')).toMatchObject({ checked: true });
  });

  it('drops the view submenu for a surface with no settings to report', () => {
    // An inline simulation window has no options pane, so four toggles that
    // report nothing would be worse than none.
    const items = simulatorMenuItems(deps({ settings: null }));

    expect(ids(items)).not.toContain('simulator.toggleFaces');
    expect(items.some((item) => item.kind === 'submenu')).toBe(false);
  });

  it('dispatches through the supplied runner, which is the keymap executor', () => {
    const run = vi.fn();
    const items = simulatorMenuItems(deps({ run }));
    const replay = find(items, 'simulator.replay');

    if (replay && replay.kind === 'action') replay.onSelect();

    expect(run).toHaveBeenCalledWith('simulator.replay');
  });

  it('offers the transport verbs in fold order', () => {
    const transport = ids(simulatorMenuItems(deps())).slice(0, 5);

    expect(transport).toEqual([
      'simulator.playPause',
      'simulator.foldBackward',
      'simulator.foldForward',
      'simulator.foldStart',
      'simulator.foldEnd',
    ]);
  });
});

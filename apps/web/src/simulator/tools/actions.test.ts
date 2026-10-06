import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { getShortcutDefinition } from '../../keyboard/shortcuts';
import {
  simulatorCanvasLabels,
  simulatorToolButtons,
  simulatorToolMenuVerbs,
  simulatorToolWindow,
  type SimulatorToolHost,
  type SimulatorToolVerbs,
} from './actions';
import { SIMULATOR_TOOLS } from './catalog';
import { DEFAULT_SIMULATOR_TOOL_OPTIONS, type SimulatorToolsView } from './types';

/**
 * Returns the English default, with plurals and `{{…}}` filled in, so the
 * assertions read as the UI does.
 */
const t = ((_key: string, a?: unknown, b?: unknown) => {
  const fill = (template: string, values: Record<string, unknown> = {}) =>
    template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name]));
  if (typeof a === 'string') return fill(a, b as Record<string, unknown>);
  const options = a as Record<string, unknown>;
  const template = options.count === 1 ? options.defaultValue_one : options.defaultValue_other;
  return fill(template as string, options);
}) as unknown as TFunction;

function view(extra: Partial<SimulatorToolsView> = {}): SimulatorToolsView {
  return {
    activeToolId: 'orbit',
    pinnedCount: 0,
    options: DEFAULT_SIMULATOR_TOOL_OPTIONS,
    notices: [],
    posed: false,
    ...extra,
  };
}

function verbs(): SimulatorToolVerbs {
  return { selectTool: vi.fn(), clearPins: vi.fn(), setOption: vi.fn(), springBack: vi.fn() };
}

const MAC: SimulatorToolHost = { apple: true, coarse: false };
const PC: SimulatorToolHost = { apple: false, coarse: false };
const PHONE: SimulatorToolHost = { apple: true, coarse: true };

describe('the tool catalog', () => {
  it('names a registered simulator verb, bound to a key, for every tool', () => {
    for (const tool of SIMULATOR_TOOLS) {
      const definition = getShortcutDefinition(tool.shortcut);
      expect(definition?.scope, tool.id).toBe('simulator');
      expect(definition?.defaultChords.length, tool.id).toBeGreaterThan(0);
    }
  });
});

describe('simulatorToolButtons', () => {
  it('lists Orbit, Pin then Pull, with the active one marked and each selecting itself', () => {
    const bound = verbs();
    const buttons = simulatorToolButtons(t, view({ activeToolId: 'pin' }), bound, 'rail');

    expect(buttons.map((button) => [button.id, button.label, button.active])).toEqual([
      ['orbit', 'Orbit', false],
      ['pin', 'Pin', true],
      ['pull', 'Pull', false],
    ]);
    buttons[0].select();
    expect(bound.selectTool).toHaveBeenCalledWith('orbit', 'rail');
  });

  it('marks Pin while pins exist and another tool is in hand', () => {
    const badge = (extra: Partial<SimulatorToolsView>) =>
      simulatorToolButtons(t, view(extra), verbs(), 'picker').find((button) => button.id === 'pin')?.badge;

    expect(badge({ pinnedCount: 3 })).toBe(true);
    expect(badge({ pinnedCount: 3, activeToolId: 'pin' })).toBe(false);
    expect(badge({ pinnedCount: 0 })).toBe(false);
  });

  it('marks Pull while the paper holds a pose and another tool is in hand', () => {
    const badge = (extra: Partial<SimulatorToolsView>) =>
      simulatorToolButtons(t, view(extra), verbs(), 'rail').find((button) => button.id === 'pull')?.badge;

    expect(badge({ posed: true })).toBe(true);
    expect(badge({ posed: true, activeToolId: 'pull' })).toBe(false);
    expect(badge({ posed: false })).toBe(false);
  });
});

describe('simulatorToolWindow', () => {
  it('shows nothing under Orbit while there is nothing pinned and nothing to say', () => {
    expect(simulatorToolWindow(t, view(), verbs(), MAC)).toBeNull();
  });

  it('shows the pins under Orbit, with Clear', () => {
    const bound = verbs();
    const window = simulatorToolWindow(t, view({ pinnedCount: 3 }), bound, MAC);

    expect(window).toMatchObject({
      kind: 'pins',
      title: 'Pins',
      meta: '3 faces pinned',
      instructions: [],
      toggles: [],
      pins: { clearLabel: 'Clear pins' },
    });
    window?.pins?.clear();
    expect(bound.clearPins).toHaveBeenCalledWith('tool-window');
  });

  it('keeps a notice on screen under Orbit even once the pins are gone', () => {
    const window = simulatorToolWindow(t, view({ notices: ['recovered'] }), verbs(), MAC);

    expect(window?.pins).toBeNull();
    expect(window?.notices).toEqual([
      'The simulation became unstable and restarted from flat. Pins now hold the flat sheet.',
    ]);
  });

  it('gives the Pin tool its instructions, the layers toggle, and Clear once something is pinned', () => {
    const bound = verbs();
    const empty = simulatorToolWindow(t, view({ activeToolId: 'pin' }), bound, MAC);
    expect(empty).toMatchObject({ kind: 'pin', title: 'Pin', meta: 'Instructions', pins: null });
    expect(empty?.instructions).toHaveLength(3);
    expect(empty?.toggles).toMatchObject([
      { id: 'pinThroughLayers', label: 'Select through all layers', checked: true },
    ]);
    empty?.toggles[0].set(false);
    expect(bound.setOption).toHaveBeenCalledWith('pinThroughLayers', false, 'tool-window');

    const one = simulatorToolWindow(t, view({ activeToolId: 'pin', pinnedCount: 1 }), bound, MAC);
    expect(one?.meta).toBe('1 face pinned');
    expect(one?.pins?.clearLabel).toBe('Clear pins');
  });

  it('says how to turn the model in the terms this device has', () => {
    const last = (host: SimulatorToolHost) =>
      simulatorToolWindow(t, view({ activeToolId: 'pin' }), verbs(), host)?.instructions.at(-1);

    expect(last(MAC)).toBe('Cmd-drag turns the model.');
    expect(last(PC)).toBe('Drag with the middle button to turn the model.');
    expect(last(PHONE)).toBe('Switch to Orbit to turn the model.');
  });
});

describe('the Pull tool’s window', () => {
  it('asks for pins first when there are none, with Pin as the way to make some', () => {
    const bound = verbs();
    const window = simulatorToolWindow(t, view({ activeToolId: 'pull' }), bound, MAC);

    expect(window).toMatchObject({
      kind: 'pull',
      title: 'Pull',
      meta: 'Instructions',
      pins: null,
      pose: null,
      needsPins: { text: 'Pin the faces that should hold still, then pull.', pinLabel: 'Pin faces' },
    });
    window?.needsPins?.pin();
    expect(bound.selectTool).toHaveBeenCalledWith('pin', 'tool-window');
  });

  it('says how to pull, keep and put it back, in this device’s terms', () => {
    const instructions = (host: SimulatorToolHost) =>
      simulatorToolWindow(t, view({ activeToolId: 'pull', pinnedCount: 2 }), verbs(), host)?.instructions;

    expect(instructions(MAC)).toEqual([
      'Drag the paper to pull it. Pinned faces hold still.',
      'Let go and it stays. Play or scrub the fold to let it spring back.',
      'Esc while dragging puts it back.',
      'Cmd-drag turns the model.',
    ]);
    expect(instructions(PHONE)?.at(-1)).toBe('Switch to Orbit to turn the model.');
    expect(instructions(PHONE)).toHaveLength(3);
  });

  it('offers Spring back while posed, under any tool', () => {
    const bound = verbs();
    const pulling = simulatorToolWindow(t, view({ activeToolId: 'pull', pinnedCount: 1, posed: true }), bound, MAC);
    expect(pulling?.pose?.springBackLabel).toBe('Spring back');
    pulling?.pose?.springBack();
    expect(bound.springBack).toHaveBeenCalledWith('tool-window');

    const orbiting = simulatorToolWindow(t, view({ posed: true }), verbs(), MAC);
    expect(orbiting).toMatchObject({ kind: 'pins', title: 'Pose', meta: 'Posed', pins: null });
    expect(orbiting?.pose).not.toBeNull();

    const pinning = simulatorToolWindow(t, view({ activeToolId: 'pin', posed: true }), verbs(), MAC);
    expect(pinning?.pose).not.toBeNull();
  });
});

describe('simulatorToolMenuVerbs', () => {
  it('offers Clear only while there are pins, and Spring back only while posed', () => {
    expect(simulatorToolMenuVerbs(view())).toEqual([]);
    expect(simulatorToolMenuVerbs(view({ pinnedCount: 2 }))).toEqual(['simulator.pins.clear']);
    expect(simulatorToolMenuVerbs(view({ pinnedCount: 2, posed: true }))).toEqual([
      'simulator.pins.clear',
      'simulator.pull.springBack',
    ]);
  });
});

describe('simulatorCanvasLabels', () => {
  it('says what a drag on the canvas does under each tool', () => {
    expect(simulatorCanvasLabels(t, 'orbit').title).toBe('Drag to rotate, scroll to zoom, double-click to reset view');
    expect(simulatorCanvasLabels(t, 'pin').title).toBe('Drag a box or click a face to pin it, scroll to zoom');
    expect(simulatorCanvasLabels(t, 'pull').title).toBe('Drag the paper to pull it, scroll to zoom');
    expect(simulatorCanvasLabels(t, 'pull').ariaLabel).toContain('pull it around its pins');
  });
});

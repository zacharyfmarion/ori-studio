import { describe, expect, it, vi } from 'vitest';
import { handleShortcutKeyDown } from '../keyboard/shortcutDispatcher';
import { SHORTCUT_DEFINITIONS, type SimulatorShortcutId } from '../keyboard/shortcuts';
import {
  runSimulatorShortcut,
  type SimulatorShortcutHandlers,
  type SimulatorToolShortcutHandlers,
} from './useSimulatorShortcuts';

function handlers(extra: Partial<SimulatorShortcutHandlers> = {}): SimulatorShortcutHandlers {
  return {
    playPause: vi.fn(),
    nudgeFold: vi.fn(),
    setFoldPercent: vi.fn(),
    rewind: vi.fn(),
    restart: vi.fn(),
    resetView: vi.fn(),
    zoomBy: vi.fn(),
    ...extra,
  };
}

function toolHandlers(
  extra: Partial<SimulatorToolShortcutHandlers> = {}
): SimulatorToolShortcutHandlers {
  return {
    selectTool: vi.fn(),
    exitTool: vi.fn(() => true),
    clearPins: vi.fn(),
    togglePinThroughLayers: vi.fn(),
    springBack: vi.fn(),
    ...extra,
  };
}

const TOOL_VERBS: SimulatorShortcutId[] = [
  'simulator.tool.orbit',
  'simulator.tool.pin',
  'simulator.tool.pull',
  'simulator.tool.exit',
  'simulator.pins.clear',
  'simulator.pins.throughLayers',
  'simulator.pull.springBack',
];

describe('runSimulatorShortcut', () => {
  it('routes the rail’s two verbs to their handlers', () => {
    const exportView = vi.fn();
    const setUpright = vi.fn();
    const bound = handlers({ exportView, setUpright });

    runSimulatorShortcut('simulator.exportView', bound, 5);
    expect(exportView).toHaveBeenCalledTimes(1);
    expect(setUpright).not.toHaveBeenCalled();

    runSimulatorShortcut('simulator.setUpright', bound, 5);
    expect(setUpright).toHaveBeenCalledTimes(1);
  });

  it('does nothing for them on a surface that does not answer them', () => {
    // An inline simulation window keeps its own toolbar buttons and binds
    // neither, so a chord the user gave these reaches nothing there.
    const bound = handlers();

    expect(() => runSimulatorShortcut('simulator.exportView', bound, 5)).not.toThrow();
    expect(() => runSimulatorShortcut('simulator.setUpright', bound, 5)).not.toThrow();
    expect(bound.resetView).not.toHaveBeenCalled();
  });

  it('claims every verb that is not a tool verb, handler or not', () => {
    // F on an inline window toggles nothing, and must still not reach the Fold
    // tool beneath it: that was the behaviour before a verb could decline.
    const bound = handlers();
    const verbs = SHORTCUT_DEFINITIONS.filter((definition) => definition.scope === 'simulator')
      .map((definition) => definition.id as SimulatorShortcutId)
      .filter((id) => !TOOL_VERBS.includes(id));

    expect(verbs.length).toBeGreaterThan(0);
    for (const id of verbs) {
      expect(runSimulatorShortcut(id, bound, 5), id).toBe(true);
    }
  });

  it('declines every tool verb on a surface without tools', () => {
    const bound = handlers();
    for (const id of TOOL_VERBS) {
      expect(runSimulatorShortcut(id, bound, 5), id).toBe(false);
    }
  });

  it('routes the tool verbs, with where they were asked for', () => {
    const tools = toolHandlers();
    const bound = handlers({ tools });

    expect(runSimulatorShortcut('simulator.tool.pin', bound, 5)).toBe(true);
    expect(runSimulatorShortcut('simulator.tool.orbit', bound, 5)).toBe(true);
    expect(runSimulatorShortcut('simulator.pins.clear', bound, 5, 'context-menu')).toBe(true);
    expect(runSimulatorShortcut('simulator.pins.throughLayers', bound, 5)).toBe(true);
    expect(runSimulatorShortcut('simulator.tool.pull', bound, 5)).toBe(true);
    expect(runSimulatorShortcut('simulator.pull.springBack', bound, 5, 'context-menu')).toBe(true);

    expect(tools.selectTool).toHaveBeenNthCalledWith(1, 'pin', 'shortcut');
    expect(tools.selectTool).toHaveBeenNthCalledWith(2, 'orbit', 'shortcut');
    expect(tools.selectTool).toHaveBeenNthCalledWith(3, 'pull', 'shortcut');
    expect(tools.clearPins).toHaveBeenCalledWith('context-menu');
    expect(tools.togglePinThroughLayers).toHaveBeenCalledWith('shortcut');
    expect(tools.springBack).toHaveBeenCalledWith('context-menu');
  });

  it('claims Escape only when exiting did something', () => {
    const exitTool = vi.fn(() => false);
    const bound = handlers({ tools: toolHandlers({ exitTool }) });

    expect(runSimulatorShortcut('simulator.tool.exit', bound, 5)).toBe(false);
    exitTool.mockReturnValue(true);
    expect(runSimulatorShortcut('simulator.tool.exit', bound, 5)).toBe(true);
    expect(exitTool).toHaveBeenCalledTimes(2);
  });
});

describe('the simulator keymap through the dispatcher', () => {
  const stack = ['simulator', 'viewport', 'crease-pattern', 'global'] as const;

  function press(key: string) {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  }

  it('lets an inline window pass Escape through to the canvas beneath it', () => {
    // An inline window registers the simulator executor while it has focus, and
    // has no tools. Before the executor could decline, binding Escape in the
    // simulator scope would have swallowed `viewport.cancel` here.
    const viewport = vi.fn(() => true);
    const inline = handlers();

    handleShortcutKeyDown(press('Escape'), {
      scopeStack: [...stack],
      executors: {
        simulator: (id) => runSimulatorShortcut(id, inline, 5),
        viewport,
      },
    });

    expect(viewport).toHaveBeenCalledWith('viewport.cancel');
  });

  it('gives the Simulate workspace its tool keys', () => {
    const viewport = vi.fn(() => true);
    const tools = toolHandlers();
    const workspace = handlers({ tools });

    for (const key of ['p', 'o', 'u', 'Escape']) {
      handleShortcutKeyDown(press(key), {
        scopeStack: [...stack],
        executors: {
          simulator: (id) => runSimulatorShortcut(id, workspace, 5),
          viewport,
        },
      });
    }

    expect(tools.selectTool).toHaveBeenNthCalledWith(1, 'pin', 'shortcut');
    expect(tools.selectTool).toHaveBeenNthCalledWith(2, 'orbit', 'shortcut');
    expect(tools.selectTool).toHaveBeenNthCalledWith(3, 'pull', 'shortcut');
    expect(tools.exitTool).toHaveBeenCalledTimes(1);
    expect(viewport).not.toHaveBeenCalled();
  });
});

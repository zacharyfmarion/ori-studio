import { describe, expect, it, vi } from 'vitest';
import { runSimulatorShortcut, type SimulatorShortcutHandlers } from './useSimulatorShortcuts';

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
});

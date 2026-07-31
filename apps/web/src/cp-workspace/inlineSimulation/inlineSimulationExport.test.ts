import { describe, expect, it, vi } from 'vitest';
import {
  exportInlineSimulation,
  registerInlineSimulationExporter,
} from './inlineSimulationRuntime';

/**
 * The registry that lets a window's floating toolbar reach the window's own
 * simulator runtime. They are siblings, so there is no prop path between them,
 * and this indirection is what keeps the call out of the crease-pattern panel.
 */
describe('inline simulation view export', () => {
  it('routes an export to the window that registered it', async () => {
    const first = vi.fn().mockResolvedValue(true);
    const second = vi.fn().mockResolvedValue(true);
    const unregisterFirst = registerInlineSimulationExporter('a', first);
    const unregisterSecond = registerInlineSimulationExporter('b', second);

    await exportInlineSimulation('b', 'svg');
    expect(second).toHaveBeenCalledWith('svg');
    expect(first).not.toHaveBeenCalled();

    unregisterFirst();
    unregisterSecond();
  });

  it('answers false for a window that is not mounted', async () => {
    // A toolbar can outlive its window by a frame; that is not a fault.
    await expect(exportInlineSimulation('gone', 'png')).resolves.toBe(false);
  });

  it('stops routing once a window unregisters', async () => {
    const exporter = vi.fn().mockResolvedValue(true);
    registerInlineSimulationExporter('c', exporter)();

    await expect(exportInlineSimulation('c', 'svg')).resolves.toBe(false);
    expect(exporter).not.toHaveBeenCalled();
  });

  it('does not let a late cleanup unregister its replacement', async () => {
    // React can run the previous effect's cleanup *after* the next effect has
    // registered, when the callback identity changes. Without the guard that
    // stale cleanup silently deletes the live exporter and the button goes dead.
    const stale = vi.fn().mockResolvedValue(true);
    const live = vi.fn().mockResolvedValue(true);
    const unregisterStale = registerInlineSimulationExporter('d', stale);
    const unregisterLive = registerInlineSimulationExporter('d', live);

    unregisterStale();
    await exportInlineSimulation('d', 'svg');
    expect(live).toHaveBeenCalledWith('svg');

    unregisterLive();
  });
});

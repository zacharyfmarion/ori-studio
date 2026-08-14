import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSimulatorView, simulatorView } from './simulatorViewRegistry';

/**
 * The registry the "Set upright" controls reach their viewport through.
 *
 * Two surfaces publish into it and they have different lifetimes, which is the
 * whole reason the contract below matters:
 *
 * - The Simulate workspace has exactly one viewport, registered for the panel's
 *   life.
 * - The Edit canvas can have **many** inline simulation windows mounted at once,
 *   and only the focused one registers — the same scoping its keyboard shortcuts
 *   use. So registrations overlap in time, and the wrong unregister winning would
 *   leave the toolbar pointing at a window the user is no longer driving, or at
 *   nothing.
 */

const noop = { setUpright: () => {} };

afterEach(() => {
  // Leave nothing registered for the next test.
  registerSimulatorView(noop)();
});

describe('the mounted simulation registry', () => {
  it('reports nothing when no simulation is mounted', () => {
    registerSimulatorView(noop)();
    expect(simulatorView()).toBeNull();
  });

  it('hands back the registered handle', () => {
    const handle = { setUpright: vi.fn() };
    registerSimulatorView(handle);

    simulatorView()?.setUpright();

    expect(handle.setUpright).toHaveBeenCalledOnce();
  });

  it('lets a newer registration win while an older one is still mounted', () => {
    // Focus moving between two inline windows: the second registers before the
    // first has torn down.
    const first = { setUpright: vi.fn() };
    const second = { setUpright: vi.fn() };
    registerSimulatorView(first);
    registerSimulatorView(second);

    simulatorView()?.setUpright();

    expect(second.setUpright).toHaveBeenCalledOnce();
    expect(first.setUpright).not.toHaveBeenCalled();
  });

  it('does not let a stale unregister clear a newer registration', () => {
    // The bug the identity check exists for. Without it the first window's
    // cleanup — which runs *after* the second has registered — would null the
    // registry and the toolbar would silently do nothing.
    const first = { setUpright: vi.fn() };
    const second = { setUpright: vi.fn() };
    const unregisterFirst = registerSimulatorView(first);
    registerSimulatorView(second);

    unregisterFirst();

    expect(simulatorView()).not.toBeNull();
    simulatorView()?.setUpright();
    expect(second.setUpright).toHaveBeenCalledOnce();
  });

  it('clears on its own unregister, so a closed window leaves nothing behind', () => {
    const handle = { setUpright: vi.fn() };
    const unregister = registerSimulatorView(handle);

    unregister();

    expect(simulatorView()).toBeNull();
  });
});

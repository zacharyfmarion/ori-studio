import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SIMULATE_TOOL_STATE } from './simulateToolState';

const WHOLE = { revision: 1, sourceKey: 'whole:1:all' };

beforeEach(() => {
  useWorkspaceStore.setState({
    simulatorActiveToolId: 'orbit',
    simulatorPins: { revision: null, bySource: {} },
    simulatorToolOptions: { pinThroughLayers: true },
  });
});

describe('SIMULATE_TOOL_STATE', () => {
  it('reads the slice’s tool and options as one object until either changes', () => {
    const first = SIMULATE_TOOL_STATE.getSnapshot();
    expect(first).toEqual({ activeToolId: 'orbit', options: { pinThroughLayers: true } });

    // Nothing the tools read: the same object, so a subscriber does not render.
    useWorkspaceStore.setState({ selectedSegmentId: 3 });
    useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [2]);
    expect(SIMULATE_TOOL_STATE.getSnapshot()).toBe(first);

    SIMULATE_TOOL_STATE.setActiveTool('pin');
    const picked = SIMULATE_TOOL_STATE.getSnapshot();
    expect(picked).not.toBe(first);
    expect(picked.activeToolId).toBe('pin');
    expect(useWorkspaceStore.getState().simulatorActiveToolId).toBe('pin');

    SIMULATE_TOOL_STATE.setOption('pinThroughLayers', false);
    expect(SIMULATE_TOOL_STATE.getSnapshot().options.pinThroughLayers).toBe(false);
    expect(useWorkspaceStore.getState().simulatorToolOptions.pinThroughLayers).toBe(false);
  });

  it('keeps pins per source, as the same array until that source’s change', () => {
    SIMULATE_TOOL_STATE.setPins(WHOLE, [3, 4]);
    const pins = SIMULATE_TOOL_STATE.getPins(WHOLE);
    expect(pins).toEqual([3, 4]);
    expect(useWorkspaceStore.getState().simulatorPins).toEqual({
      revision: 1,
      bySource: { 'whole:1:all': [3, 4] },
    });

    SIMULATE_TOOL_STATE.setPins({ revision: 1, sourceKey: 'whole:1:a' }, [7]);
    expect(SIMULATE_TOOL_STATE.getPins(WHOLE)).toBe(pins);
    expect(SIMULATE_TOOL_STATE.getPins({ revision: 1, sourceKey: 'whole:1:a' })).toEqual([7]);
  });

  it('forgets every source’s pins when the fold revision moves on', () => {
    SIMULATE_TOOL_STATE.setPins(WHOLE, [3]);
    SIMULATE_TOOL_STATE.setPins({ revision: 2, sourceKey: 'whole:2:all' }, [6]);

    expect(SIMULATE_TOOL_STATE.getPins(WHOLE)).toEqual([]);
    expect(SIMULATE_TOOL_STATE.getPins({ revision: 2, sourceKey: 'whole:2:all' })).toEqual([6]);
  });

  it('tells a subscriber about store changes until it unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = SIMULATE_TOOL_STATE.subscribe(listener);
    SIMULATE_TOOL_STATE.setActiveTool('pull');
    expect(listener).toHaveBeenCalledTimes(1);
    // Called with nothing: useSyncExternalStore's listener takes no arguments.
    expect(listener).toHaveBeenCalledWith();

    unsubscribe();
    SIMULATE_TOOL_STATE.setActiveTool('orbit');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

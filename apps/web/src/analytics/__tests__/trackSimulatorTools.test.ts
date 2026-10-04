import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The simulator tools' events carry enums and buckets only — never a face id,
 * a coordinate or an exact count.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const {
  trackSimulatorPinnedFoldMoved,
  trackSimulatorPinsCleared,
  trackSimulatorPinsEdited,
  trackSimulatorSolverRecovered,
  trackSimulatorToolOptionChanged,
  trackSimulatorToolPickerOpened,
  trackSimulatorToolSelected,
} = await import('../trackSimulatorTools');

beforeEach(() => {
  runtime.track.mockClear();
});

describe('simulator tool events', () => {
  it('names the tool and where it was picked', () => {
    trackSimulatorToolSelected({ tool: 'pin', source: 'rail' });
    expect(runtime.track).toHaveBeenCalledWith('simulator tool selected', { tool: 'pin', source: 'rail' });
  });

  it('counts the phone sheet opening with nothing attached', () => {
    trackSimulatorToolPickerOpened();
    expect(runtime.track.mock.calls).toEqual([['simulator tool picker opened']]);
  });

  it('reports a pin gesture as enums and a bucket', () => {
    trackSimulatorPinsEdited({
      gesture: 'box',
      mode: 'add',
      depth: 'all-layers',
      outcome: 'changed',
      pinnedCount: 7,
    });
    expect(runtime.track).toHaveBeenCalledWith('simulator pins edited', {
      gesture: 'box',
      mode: 'add',
      depth: 'all-layers',
      outcome: 'changed',
      pinned_count_bucket: '<=20',
    });
  });

  it('tells an emptied set from a single face', () => {
    trackSimulatorPinsEdited({ gesture: 'click', mode: 'replace', depth: 'front', outcome: 'empty', pinnedCount: 0 });
    trackSimulatorPinsCleared({ source: 'tool-window', pinnedCount: 1 });
    expect(runtime.track.mock.calls.map((call) => (call[1] as Record<string, unknown>).pinned_count_bucket)).toEqual([
      '<=0',
      '<=1',
    ]);
  });

  it('reports an option as on or off', () => {
    trackSimulatorToolOptionChanged({ tool: 'pin', option: 'through-layers', value: false, source: 'shortcut' });
    expect(runtime.track).toHaveBeenCalledWith('simulator tool option changed', {
      tool: 'pin',
      option: 'through-layers',
      value: 'off',
      source: 'shortcut',
    });
  });

  it('reports the fold moving around pins, and the solver recovering', () => {
    trackSimulatorPinnedFoldMoved({ direction: 'unfold', pinnedCount: 600 });
    trackSimulatorSolverRecovered({ action: 'reset', pinned: true });
    expect(runtime.track.mock.calls).toEqual([
      ['simulator pinned fold moved', { direction: 'unfold', pinned_count_bucket: '>500' }],
      ['simulator solver recovered', { action: 'reset', pinned: 'yes' }],
    ]);
  });
});

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
  trackSimulatorModelPulled,
  trackSimulatorPinnedFoldMoved,
  trackSimulatorPinsCleared,
  trackSimulatorPinsEdited,
  trackSimulatorPoseReleased,
  trackSimulatorPullRefused,
  trackSimulatorSolverRecovered,
  trackSimulatorToolOptionChanged,
  trackSimulatorToolPickerOpened,
  trackSimulatorToolSelected,
} = await import('../trackSimulatorTools');

beforeEach(() => {
  runtime.track.mockClear();
});

const SIMULATE = { surface: 'simulate' } as const;

describe('simulator tool events', () => {
  it('names the tool and where it was picked', () => {
    trackSimulatorToolSelected({ ...SIMULATE, tool: 'pin', source: 'rail' });
    expect(runtime.track).toHaveBeenCalledWith('simulator tool selected', {
      surface: 'simulate',
      tool: 'pin',
      source: 'rail',
    });
  });

  it('counts the phone sheet opening with only its host attached', () => {
    trackSimulatorToolPickerOpened(SIMULATE);
    expect(runtime.track.mock.calls).toEqual([['simulator tool picker opened', { surface: 'simulate' }]]);
  });

  it('reports a pin gesture as enums and a bucket', () => {
    trackSimulatorPinsEdited({
      ...SIMULATE,
      gesture: 'box',
      mode: 'add',
      depth: 'all-layers',
      outcome: 'changed',
      pinnedCount: 7,
    });
    expect(runtime.track).toHaveBeenCalledWith('simulator pins edited', {
      surface: 'simulate',
      gesture: 'box',
      mode: 'add',
      depth: 'all-layers',
      outcome: 'changed',
      pinned_count_bucket: '<=20',
    });
  });

  it('tells an emptied set from a single face', () => {
    trackSimulatorPinsEdited({
      ...SIMULATE,
      gesture: 'click',
      mode: 'replace',
      depth: 'front',
      outcome: 'empty',
      pinnedCount: 0,
    });
    trackSimulatorPinsCleared({ ...SIMULATE, source: 'tool-window', pinnedCount: 1 });
    expect(runtime.track.mock.calls.map((call) => (call[1] as Record<string, unknown>).pinned_count_bucket)).toEqual([
      '<=0',
      '<=1',
    ]);
  });

  it('reports an option as on or off', () => {
    trackSimulatorToolOptionChanged({ ...SIMULATE, tool: 'pin', option: 'through-layers', value: false, source: 'shortcut' });
    expect(runtime.track).toHaveBeenCalledWith('simulator tool option changed', {
      surface: 'simulate',
      tool: 'pin',
      option: 'through-layers',
      value: 'off',
      source: 'shortcut',
    });
  });

  it('reports the fold moving around pins, and the solver recovering', () => {
    trackSimulatorPinnedFoldMoved({ ...SIMULATE, direction: 'unfold', pinnedCount: 600 });
    trackSimulatorSolverRecovered({ ...SIMULATE, action: 'reset', pinned: true });
    expect(runtime.track.mock.calls).toEqual([
      ['simulator pinned fold moved', { surface: 'simulate', direction: 'unfold', pinned_count_bucket: '>500' }],
      ['simulator solver recovered', { surface: 'simulate', action: 'reset', pinned: 'yes' }],
    ]);
  });

  it('reports a pull as enums and buckets, a press let go where it was included', () => {
    trackSimulatorModelPulled({ ...SIMULATE, outcome: 'kept', touch: false, pinnedCount: 3, movedCreases: 12 });
    trackSimulatorModelPulled({ ...SIMULATE, outcome: 'cancelled', touch: true, pinnedCount: 1, movedCreases: 0 });
    expect(runtime.track.mock.calls).toEqual([
      [
        'simulator model pulled',
        {
          surface: 'simulate',
          outcome: 'kept',
          input: 'pointer',
          pinned_count_bucket: '<=5',
          moved_creases_bucket: '<=20',
        },
      ],
      [
        'simulator model pulled',
        {
          surface: 'simulate',
          outcome: 'cancelled',
          input: 'touch',
          pinned_count_bucket: '<=1',
          moved_creases_bucket: '<=0',
        },
      ],
    ]);
  });

  it('says why a pull did not grip, what ended a pose, and when Pull sent someone to Pin', () => {
    trackSimulatorPullRefused({ ...SIMULATE, reason: 'no-pins' });
    trackSimulatorPoseReleased({ ...SIMULATE, source: 'fold-control' });
    trackSimulatorToolSelected({ ...SIMULATE, tool: 'pin', source: 'tool-window' });
    expect(runtime.track.mock.calls).toEqual([
      ['simulator pull refused', { surface: 'simulate', reason: 'no-pins' }],
      ['simulator pose released', { surface: 'simulate', source: 'fold-control' }],
      ['simulator tool selected', { surface: 'simulate', tool: 'pin', source: 'tool-window' }],
    ]);
  });

  it('says which host every event came from', () => {
    const POSE = { surface: 'diagram-pose' } as const;
    trackSimulatorToolSelected({ ...POSE, tool: 'pull', source: 'shortcut' });
    trackSimulatorToolPickerOpened(POSE);
    trackSimulatorPinsEdited({ ...POSE, gesture: 'tap', mode: 'toggle', depth: 'front', outcome: 'changed', pinnedCount: 2 });
    trackSimulatorPinsCleared({ ...POSE, source: 'context-menu', pinnedCount: 2 });
    trackSimulatorToolOptionChanged({ ...POSE, tool: 'pin', option: 'through-layers', value: true, source: 'tool-window' });
    trackSimulatorPinnedFoldMoved({ ...POSE, direction: 'fold', pinnedCount: 2 });
    trackSimulatorSolverRecovered({ ...POSE, action: 'arrest', pinned: true });
    trackSimulatorModelPulled({ ...POSE, outcome: 'kept', touch: false, pinnedCount: 2, movedCreases: 1 });
    trackSimulatorPullRefused({ ...POSE, reason: 'missed' });
    trackSimulatorPoseReleased({ ...POSE, source: 'shortcut' });

    expect(runtime.track).toHaveBeenCalledTimes(10);
    for (const [, properties] of runtime.track.mock.calls) {
      expect(properties).toMatchObject({ surface: 'diagram-pose' });
    }
  });
});

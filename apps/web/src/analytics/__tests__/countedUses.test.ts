import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUseCounter, USE_COUNT_WINDOW_MS } from '../countedUses';

const OPENED = new Date(2026, 10, 25, 9, 0, 0);

function setup() {
  const capture = vi.fn();
  const counter = createUseCounter(capture);
  const draw = () => counter.record('cp tool used', { operation: 'DrawCreaseFree', group: 'draw' });
  return { capture, counter, draw };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(OPENED);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createUseCounter', () => {
  it('sends the first use at once, marked, and nothing for the uses after it', () => {
    const { capture, draw } = setup();

    draw();
    draw();
    draw();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('cp tool used', {
      operation: 'DrawCreaseFree',
      group: 'draw',
      counting: 'first_in_window',
    });
  });

  it('counts each tool and each command apart', () => {
    const { capture, counter, draw } = setup();

    draw();
    counter.record('cp tool used', { operation: 'LineSegmentDelete', group: 'delete' });
    counter.record('command invoked', { command_id: 'edit.undo', command_group: 'edit' });
    counter.record('command invoked', { command_id: 'edit.undo', command_group: 'edit' });

    expect(capture.mock.calls.map(([eventName, properties]) => [eventName, properties.operation ?? properties.command_id])).toEqual([
      ['cp tool used', 'DrawCreaseFree'],
      ['cp tool used', 'LineSegmentDelete'],
      ['command invoked', 'edit.undo'],
    ]);
  });

  it('sends each count when the window closes, bucketed and dated to when it opened', () => {
    const { capture, counter, draw } = setup();

    for (let i = 0; i < 6; i += 1) draw();
    vi.advanceTimersByTime(10 * 60 * 1000);
    counter.record('command invoked', { command_id: 'edit.undo', command_group: 'edit' });
    capture.mockClear();

    vi.advanceTimersByTime(USE_COUNT_WINDOW_MS - 10 * 60 * 1000);

    expect(capture.mock.calls).toEqual([
      [
        'cp tool uses counted',
        { operation: 'DrawCreaseFree', group: 'draw', use_count_bucket: '<=10' },
        { timestamp: OPENED },
      ],
      [
        'command uses counted',
        { command_id: 'edit.undo', command_group: 'edit', use_count_bucket: '<=1' },
        { timestamp: OPENED },
      ],
    ]);
  });

  it.each([
    [1, '<=1'],
    [5, '<=5'],
    [6, '<=10'],
    [500, '<=500'],
    [501, '>500'],
  ])('puts %i uses in %s', (uses, bucket) => {
    const { capture, counter, draw } = setup();
    for (let i = 0; i < uses; i += 1) draw();

    counter.flush();

    expect(capture).toHaveBeenLastCalledWith(
      'cp tool uses counted',
      expect.objectContaining({ use_count_bucket: bucket }),
      expect.anything()
    );
  });

  it('sends a first use again once a window has closed', () => {
    const { capture, counter, draw } = setup();
    draw();
    counter.flush();
    capture.mockClear();

    vi.setSystemTime(new Date(2026, 10, 25, 9, 45, 0));
    draw();
    draw();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('cp tool used', expect.objectContaining({ counting: 'first_in_window' }));

    capture.mockClear();
    counter.flush();
    expect(capture).toHaveBeenCalledWith(
      'cp tool uses counted',
      expect.objectContaining({ use_count_bucket: '<=5' }),
      { timestamp: new Date(2026, 10, 25, 9, 45, 0) }
    );
  });

  it('sends by beacon when asked, for a page going away', () => {
    const { capture, counter, draw } = setup();
    draw();

    counter.flush({ beacon: true });

    expect(capture).toHaveBeenLastCalledWith('cp tool uses counted', expect.anything(), {
      timestamp: OPENED,
      transport: 'sendBeacon',
    });
  });

  it('flushes an early-closed window once, and leaves no timer behind', () => {
    const { capture, counter, draw } = setup();
    draw();
    counter.flush();
    capture.mockClear();

    vi.advanceTimersByTime(USE_COUNT_WINDOW_MS * 2);

    expect(capture).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing on a flush with no window open', () => {
    const { capture, counter } = setup();

    counter.flush();

    expect(capture).not.toHaveBeenCalled();
  });

  it('discards the window without sending it', () => {
    const { capture, counter, draw } = setup();
    draw();
    draw();
    capture.mockClear();

    counter.discard();
    vi.advanceTimersByTime(USE_COUNT_WINDOW_MS);

    expect(capture).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the first use’s properties, whatever the caller does with its object', () => {
    const { capture, counter } = setup();
    const properties = { operation: 'CreaseToggleMv', group: 'assign' };
    counter.record('cp tool used', properties);
    properties.group = 'changed';

    counter.flush();

    expect(capture).toHaveBeenLastCalledWith(
      'cp tool uses counted',
      { operation: 'CreaseToggleMv', group: 'assign', use_count_bucket: '<=1' },
      { timestamp: OPENED }
    );
  });
});

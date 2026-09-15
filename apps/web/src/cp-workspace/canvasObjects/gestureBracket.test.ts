import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  endOpenCanvasSessions,
  registerCanvasSessionEnder,
  resetCanvasSessionEndersForTests,
} from './canvasSessions';
import { anyGestureDraining, createGestureBracket, type GestureBracket } from './gestureBracket';

/**
 * The one undo bracket per layer: refusal on overlap, token-scoped abort,
 * global refusal while a commit drains, and nothing recorded for a gesture
 * that changed nothing.
 */
describe('createGestureBracket', () => {
  let list: readonly string[];
  let recorded: Array<{ before: readonly string[]; label: string }>;
  let bracket: GestureBracket;

  function make(beforeCommit?: () => Promise<void>): GestureBracket {
    return createGestureBracket<readonly string[]>({
      layer: 'test',
      snapshot: () => list,
      unchanged: (before, now) => before === now,
      record: (before, label) => recorded.push({ before, label }),
      ...(beforeCommit ? { beforeCommit } : {}),
    });
  }

  beforeEach(() => {
    resetCanvasSessionEndersForTests();
    list = ['a'];
    recorded = [];
    bracket = make();
  });

  afterEach(() => {
    resetCanvasSessionEndersForTests();
  });

  it('records one entry with the baseline taken at begin', async () => {
    const token = bracket.begin('canvas');
    expect(token).not.toBeNull();
    list = ['a', 'moved'];
    list = ['a', 'moved again'];
    await bracket.commit(token!, 'Move');
    expect(recorded).toEqual([{ before: ['a'], label: 'Move' }]);
    expect(bracket.openOwner()).toBeNull();
  });

  it('records nothing for a gesture that changed nothing', async () => {
    const token = bracket.begin('canvas')!;
    await bracket.commit(token, 'Move');
    expect(recorded).toEqual([]);
  });

  it('refuses a different owner while open and re-enters for the same one', () => {
    const token = bracket.begin('canvas');
    expect(bracket.begin('pane:opacity')).toBeNull();
    expect(bracket.begin('canvas')).toBe(token);
    expect(bracket.openOwner()).toBe('canvas');
  });

  it('ignores a stale token on commit and on abort', async () => {
    const first = bracket.begin('canvas')!;
    bracket.abort(first);
    list = ['a', 'b'];
    await bracket.commit(first, 'Move');
    expect(recorded).toEqual([]);

    const second = bracket.begin('pane:opacity')!;
    // A foreign token cannot kill the open gesture.
    bracket.abort(first);
    expect(bracket.isOpen(second)).toBe(true);
    list = ['a', 'b', 'c'];
    await bracket.commit(second, 'Adjust opacity');
    expect(recorded).toEqual([{ before: ['a', 'b'], label: 'Adjust opacity' }]);
  });

  it('holds the token through the drain and refuses every layer meanwhile', async () => {
    let resolveDrain: () => void = () => {};
    const draining = make(
      () =>
        new Promise<void>((resolve) => {
          resolveDrain = resolve;
        })
    );
    const other = make();
    const token = draining.begin('pane:color')!;
    list = ['a', 'red'];
    const commit = draining.commit(token, 'Change colour');
    expect(anyGestureDraining()).toBe(true);
    // Its own layer and every other one refuse while the kernel is answering.
    expect(draining.begin('canvas')).toBeNull();
    expect(draining.begin('pane:color')).toBeNull();
    expect(other.begin('canvas')).toBeNull();
    expect(draining.openOwner()).toBe('pane:color');
    resolveDrain();
    await commit;
    expect(anyGestureDraining()).toBe(false);
    expect(recorded).toEqual([{ before: ['a'], label: 'Change colour' }]);
    expect(other.begin('canvas')).not.toBeNull();
  });

  it('records nothing when aborted underneath a draining commit', async () => {
    let resolveDrain: () => void = () => {};
    const draining = make(
      () =>
        new Promise<void>((resolve) => {
          resolveDrain = resolve;
        })
    );
    const token = draining.begin('pane:color')!;
    list = ['a', 'red'];
    const commit = draining.commit(token, 'Change colour');
    draining.abortAll();
    resolveDrain();
    await commit;
    expect(recorded).toEqual([]);
  });

  it('runs a verb as one entry and refuses it while another owner holds the layer', async () => {
    const result = await bracket.run('verb', 'Bring to front', () => {
      list = ['a', 'front'];
      return 42;
    });
    expect(result).toBe(42);
    expect(recorded).toEqual([{ before: ['a'], label: 'Bring to front' }]);

    bracket.begin('canvas');
    const act = vi.fn(() => {
      list = ['never'];
    });
    expect(await bracket.run('verb', 'Delete', act)).toBeUndefined();
    expect(act).not.toHaveBeenCalled();
  });

  it('notifies subscribers as the owner changes', () => {
    const seen: Array<string | null> = [];
    const unsubscribe = bracket.subscribe(() => seen.push(bracket.openOwner()));
    const token = bracket.begin('canvas')!;
    bracket.abort(token);
    unsubscribe();
    bracket.begin('canvas');
    expect(seen).toEqual(['canvas', null]);
  });

  it('ends at the session chokepoint, sessions before brackets', () => {
    const order: string[] = [];
    const token = bracket.begin('text-session')!;
    registerCanvasSessionEnder((reason) => {
      order.push(`session:${reason}:${bracket.isOpen(token)}`);
    }, 'session');
    endOpenCanvasSessions('history');
    // The session ran first, while its token was still open, so it could have
    // committed; the bracket phase then dropped whatever was left.
    expect(order).toEqual(['session:history:true']);
    expect(bracket.openOwner()).toBeNull();
  });
});

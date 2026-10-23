import { describe, expect, it, vi } from 'vitest';
import { FOLD_MODEL_TURNS } from '../tools/foldToolCatalog';
import { createFoldTools } from '../tools/foldToolState';
import { foldCanvasVerbs, foldToolKindControl, registerFoldCanvasVerbs, withFoldCanvasVerbs } from './foldCanvasCommands';
import type { FoldCanvasVerbs } from './useFoldCanvasVerbs';

const OVER = FOLD_MODEL_TURNS['turn-over'];
const QUARTER = { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } } as const;

/** A canvas's verbs as far as a turn needs them. */
const canvas = () => ({ turn: vi.fn() }) as unknown as FoldCanvasVerbs & { turn: ReturnType<typeof vi.fn> };

describe('the canvas’s verbs, as the rail asks for them', () => {
  it('runs at once on the mounted canvas, the newest one registered', () => {
    const mounted = canvas();
    const release = registerFoldCanvasVerbs(mounted);
    withFoldCanvasVerbs((verbs) => verbs.turn(OVER));
    expect(mounted.turn).toHaveBeenCalledWith(OVER);
    const next = canvas();
    const releaseNext = registerFoldCanvasVerbs(next);
    withFoldCanvasVerbs((verbs) => verbs.turn(QUARTER));
    expect(next.turn.mock.calls).toEqual([[QUARTER]]);
    expect(mounted.turn).toHaveBeenCalledOnce();
    releaseNext();
    release();
    expect(foldCanvasVerbs()).toBeNull();
  });

  it('drops a press with no canvas, rather than landing it on one mounted later', () => {
    withFoldCanvasVerbs((verbs) => verbs.turn(OVER));
    const late = canvas();
    const release = registerFoldCanvasVerbs(late);
    expect(late.turn).not.toHaveBeenCalled();
    release();
  });
});

describe('the tools’ fold kind, as the menus arm it', () => {
  it('reads the plain fold in hand, none while another tool is, and arms a kind as its key does', () => {
    const tools = createFoldTools();
    const control = foldToolKindControl(tools);
    expect(control.kind()).toBe('valley');

    control.arm('mountain');
    expect(tools.store.getState().tool).toBe('mountain');
    expect(control.kind()).toBe('mountain');

    // A compound or vertex fold, a sink, the Divide line: no plain fold's kind is chosen.
    for (const tool of ['divide-line', 'inside-reverse', 'tuck', 'squash', 'closed-sink'] as const) {
      tools.selectTool(tool);
      expect(control.kind(), tool).toBeNull();
    }
    control.arm('precrease');
    expect(tools.store.getState().tool).toBe('precrease');
  });
});

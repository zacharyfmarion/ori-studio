import { describe, expect, it } from 'vitest';
import type { TurnRotation } from '../../../lib/steps/turn';
import { createFoldTools } from '../foldToolState';
import {
  acceptsRotationDegrees,
  FOLD_ROTATION_DEFAULT,
  rotateStepOp,
  rotationBucket,
  rotationWithDegrees,
} from './rotateTool';

const exact = (degrees: number, direction: 'cw' | 'ccw' = 'cw'): TurnRotation => ({ amount: 'degrees', degrees, direction });

describe('the Rotate tool', () => {
  it('starts a quarter turn clockwise, and adds its rotation as a rotate step', () => {
    expect(FOLD_ROTATION_DEFAULT).toEqual({ amount: 'quarter', direction: 'cw' });
    expect(rotateStepOp(exact(30))).toEqual({ kind: 'rotate', rotate: exact(30) });
  });

  it('takes an exact angle the way the direction chosen says, normalised', () => {
    const cw: TurnRotation = { amount: 'quarter', direction: 'cw' };
    const ccw: TurnRotation = { amount: 'eighth', direction: 'ccw' };
    expect(rotationWithDegrees(cw, 30)).toEqual(exact(30));
    expect(rotationWithDegrees(ccw, 30)).toEqual(exact(30, 'ccw'));
    // A negative angle is the other way; past a half turn, the rest of the turn the other way.
    expect(rotationWithDegrees(cw, -30)).toEqual(exact(30, 'ccw'));
    expect(rotationWithDegrees(cw, 200)).toEqual(exact(160, 'ccw'));
    expect(rotationWithDegrees(cw, 750)).toEqual(exact(30));
    // A preset's angle is that preset.
    expect(rotationWithDegrees(exact(30), 45)).toEqual({ amount: 'eighth', direction: 'cw' });
    expect(rotationWithDegrees(ccw, 180)).toEqual({ amount: 'half', direction: 'ccw' });
  });

  it('refuses a number that names no turn: not finite, nothing, a whole turn', () => {
    for (const typed of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, 360, -1080]) {
      expect(rotationWithDegrees(FOLD_ROTATION_DEFAULT, typed), String(typed)).toBeNull();
      expect(acceptsRotationDegrees(typed), String(typed)).toBe(false);
    }
    for (const typed of [1, -1, 22.5, 179.99, 181, 359]) expect(acceptsRotationDegrees(typed), String(typed)).toBe(true);
  });

  it('buckets how far it turned for analytics: a preset, or other for an exact angle — never the angle', () => {
    expect(rotationBucket({ amount: 'eighth', direction: 'cw' })).toBe('eighth');
    expect(rotationBucket({ amount: 'quarter', direction: 'ccw' })).toBe('quarter');
    expect(rotationBucket({ amount: 'half', direction: 'cw' })).toBe('half');
    expect(rotationBucket(exact(30))).toBe('other');
  });
});

describe('the Rotate tool in hand', () => {
  it('is taken up from another tool and puts that one back: applied, or put down with Escape', () => {
    const tools = createFoldTools();
    tools.selectTool('mountain');
    tools.selectTool('rotate');
    expect(tools.store.getState()).toMatchObject({ tool: 'rotate', resume: 'mountain', picks: [] });
    // Taken again while in hand, it keeps what it was taken up from.
    tools.selectTool('rotate');
    expect(tools.store.getState().resume).toBe('mountain');
    expect(tools.putDown()).toBe(true);
    expect(tools.store.getState().tool).toBe('mountain');
    // Not in hand: nothing to put down.
    expect(tools.putDown()).toBe(false);
    expect(tools.store.getState().tool).toBe('mountain');
  });

  it('keeps its rotation from one rotation to the next, as the line mode is kept', () => {
    const tools = createFoldTools();
    tools.selectTool('rotate');
    tools.setRotation(exact(30, 'ccw'));
    expect(tools.store.getState().rotation).toEqual(exact(30, 'ccw'));
    const before = tools.store.getState();
    tools.setRotation(exact(30, 'ccw'));
    // The same rotation is no change.
    expect(tools.store.getState()).toBe(before);
    tools.putDown();
    tools.selectTool('rotate');
    expect(tools.store.getState().rotation).toEqual(exact(30, 'ccw'));
  });

  it('collects no clicks: from the moment it is in hand there is a turn to preview', () => {
    const tools = createFoldTools();
    tools.selectTool('rotate');
    expect(tools.pick({ kind: 'free', pane: 'folded', scene: { x: 0.5, y: 0.5 }, sheet: [0.5, 0.5] })).toBe(false);
    expect(tools.store.getState().picks).toEqual([]);
    // A line mode takes a fold in hand: Rotate locates no line.
    tools.selectLineMode('free');
    expect(tools.store.getState()).toMatchObject({ tool: 'valley', lineMode: 'free' });
  });
});

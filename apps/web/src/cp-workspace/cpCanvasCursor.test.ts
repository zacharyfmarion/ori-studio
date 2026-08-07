import { describe, expect, it } from 'vitest';
import { cpCanvasCursor, type CpCanvasCursorState } from './cpCanvasCursor';

function state(overrides: Partial<CpCanvasCursorState> = {}): CpCanvasCursorState {
  return { panToolActive: false, panModifierHeld: false, panDragging: false, ...overrides };
}

describe('cpCanvasCursor', () => {
  it('shows no cursor of its own when nothing can pan', () => {
    expect(cpCanvasCursor(state())).toBeUndefined();
  });

  it('offers a grab when the hand tool is selected', () => {
    expect(cpCanvasCursor(state({ panToolActive: true }))).toBe('grab');
  });

  it('offers a grab while the pan modifier is held', () => {
    expect(cpCanvasCursor(state({ panModifierHeld: true }))).toBe('grab');
  });

  it('grabs while a pan drag is in progress, whatever started it', () => {
    // Middle button and Cmd+drag both pan without the hand tool, and used to
    // show no cursor at all.
    expect(cpCanvasCursor(state({ panDragging: true }))).toBe('grabbing');
    expect(cpCanvasCursor(state({ panDragging: true, panToolActive: true }))).toBe('grabbing');
    expect(cpCanvasCursor(state({ panDragging: true, panModifierHeld: true }))).toBe('grabbing');
  });
});

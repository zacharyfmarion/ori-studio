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

  it('offers a grab over a focused folded figure', () => {
    expect(cpCanvasCursor(state({ foldedOrbitHovered: true }))).toBe('grab');
  });

  it('leaves the cursor alone away from the figure, however it is focused', () => {
    // The regression this replaced: keyed on focus rather than the pointer, a
    // fresh fold dressed the entire canvas in a grab cursor, promising a turn
    // everywhere except over the figure.
    expect(cpCanvasCursor(state({ foldedOrbitHovered: false }))).toBeUndefined();
  });

  it('keeps the closed hand while turning, even once the drag leaves the figure', () => {
    // The pointer is captured, so a turn continues past the figure's edge. The
    // cursor has to follow it rather than reverting the moment hover is lost.
    expect(cpCanvasCursor(state({ foldedOrbitDragging: true, foldedOrbitHovered: false }))).toBe(
      'grabbing'
    );
  });

  it('lets an active tool keep its cursor while a figure is focused elsewhere', () => {
    // Focus alone is not a cursor. Only standing over the figure is.
    expect(cpCanvasCursor(state())).toBeUndefined();
  });

  it('points at something selectable, so a crease reads as clickable', () => {
    expect(cpCanvasCursor(state({ creaseHovered: true }))).toBe('pointer');
  });

  it('lets every pan and orbit affordance outrank a crease under the cursor', () => {
    // Those describe what a press will *do*, and a crease underneath does not
    // change that a Cmd-drag pans or that a focused figure turns.
    const over = { creaseHovered: true };
    expect(cpCanvasCursor(state({ ...over, panToolActive: true }))).toBe('grab');
    expect(cpCanvasCursor(state({ ...over, panModifierHeld: true }))).toBe('grab');
    expect(cpCanvasCursor(state({ ...over, foldedOrbitHovered: true }))).toBe('grab');
    expect(cpCanvasCursor(state({ ...over, panDragging: true }))).toBe('grabbing');
    expect(cpCanvasCursor(state({ ...over, foldedOrbitDragging: true }))).toBe('grabbing');
  });
});

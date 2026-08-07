import { describe, expect, it } from 'vitest';
import { DEFAULT_CREASE_EXPORT_FOLDED_FIGURE } from './creaseExport';
import {
  FOLDED_FIGURE_SIDES,
  NEW_FOLDED_FIGURE_SIDE,
  isFoldedFigureSide,
} from './foldedFigureSides';

describe('folded figure sides', () => {
  it('offers front and back only', () => {
    expect(FOLDED_FIGURE_SIDES).toEqual(['Front0', 'Back1']);
  });

  it('classifies the kernel states the UI does not offer', () => {
    expect(isFoldedFigureSide('Front0')).toBe(true);
    expect(isFoldedFigureSide('Back1')).toBe(true);
    // Overlay view modes: front and back drawn together, opaque or see-through.
    // A loaded Oriedita file can still carry either, so the guard has to answer
    // for them rather than the type alone ruling them out.
    expect(isFoldedFigureSide('Both2')).toBe(false);
    expect(isFoldedFigureSide('Transparent3')).toBe(false);
  });

  it('defaults an export to a side the pickers can show', () => {
    expect(isFoldedFigureSide(DEFAULT_CREASE_EXPORT_FOLDED_FIGURE.side)).toBe(true);
  });

  it('starts a new figure on the front, matching upstream FoldedFigure.ip4', () => {
    expect(NEW_FOLDED_FIGURE_SIDE).toBe('Front0');
  });
});

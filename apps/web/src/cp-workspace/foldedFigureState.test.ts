import { describe, expect, it } from 'vitest';
import { advanceFoldedState } from './foldedFigureState';

describe('advanceFoldedState', () => {
  it('cycles Front -> Back -> Both -> Transparent -> Front (Oriedita FlipAction)', () => {
    expect(advanceFoldedState('Front0')).toBe('Back1');
    expect(advanceFoldedState('Back1')).toBe('Both2');
    expect(advanceFoldedState('Both2')).toBe('Transparent3');
    expect(advanceFoldedState('Transparent3')).toBe('Front0');
  });
});

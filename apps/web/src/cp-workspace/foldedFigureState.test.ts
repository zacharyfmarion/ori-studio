import { describe, expect, it } from 'vitest';
import { flipFoldedState } from './foldedFigureState';

describe('flipFoldedState', () => {
  it('toggles Front <-> Back (turning the paper over)', () => {
    expect(flipFoldedState('Front0')).toBe('Back1');
    expect(flipFoldedState('Back1')).toBe('Front0');
  });

  it('resolves the overlay states to Back (reverse of the default Front view)', () => {
    expect(flipFoldedState('Both2')).toBe('Back1');
    expect(flipFoldedState('Transparent3')).toBe('Back1');
  });
});

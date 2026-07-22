import { describe, expect, it } from 'vitest';
import { bpDefaultFlapLabel, bpFlapLabel } from './bpFlapLabel';

describe('bpDefaultFlapLabel', () => {
  it('maps the first 26 ids to single letters', () => {
    expect(bpDefaultFlapLabel(0)).toBe('A');
    expect(bpDefaultFlapLabel(1)).toBe('B');
    expect(bpDefaultFlapLabel(25)).toBe('Z');
  });

  it('rolls over to two letters without repeating a label', () => {
    expect(bpDefaultFlapLabel(26)).toBe('AA');
    expect(bpDefaultFlapLabel(27)).toBe('AB');
    expect(bpDefaultFlapLabel(51)).toBe('AZ');
    expect(bpDefaultFlapLabel(52)).toBe('BA');
    expect(bpDefaultFlapLabel(701)).toBe('ZZ');
    expect(bpDefaultFlapLabel(702)).toBe('AAA');
  });

  it('is injective over a realistic id range', () => {
    const labels = new Set<string>();
    for (let id = 0; id < 1000; id += 1) labels.add(bpDefaultFlapLabel(id));
    expect(labels.size).toBe(1000);
  });

  it('never returns a label that could read as a length', () => {
    for (let id = 0; id < 200; id += 1) {
      expect(bpDefaultFlapLabel(id)).toMatch(/^[A-Z]+$/);
    }
  });

  it('clamps unusable ids instead of throwing', () => {
    expect(bpDefaultFlapLabel(-3)).toBe('A');
    expect(bpDefaultFlapLabel(Number.NaN)).toBe('A');
  });
});

describe('bpFlapLabel', () => {
  it('prefers a user-supplied name', () => {
    expect(bpFlapLabel(0, 'head')).toBe('head');
    expect(bpFlapLabel(3, '  wing  ')).toBe('wing');
  });

  it('falls back to the letter default when unnamed', () => {
    expect(bpFlapLabel(2, '')).toBe('C');
    expect(bpFlapLabel(2, '   ')).toBe('C');
  });
});

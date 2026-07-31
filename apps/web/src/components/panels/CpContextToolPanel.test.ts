import { describe, expect, it } from 'vitest';
import { cpLineTypeStatusLabel } from './CpContextToolPanel';

describe('cpLineTypeStatusLabel', () => {
  it('maps line colors to their Oriedita status label', () => {
    expect(cpLineTypeStatusLabel('Red1')).toBe('Line M');
    expect(cpLineTypeStatusLabel('Blue2')).toBe('Line V');
  });
});

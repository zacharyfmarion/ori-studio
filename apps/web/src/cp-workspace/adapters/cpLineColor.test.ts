import { describe, expect, it } from 'vitest';
import { cpLineColorVar } from './cpLineColor';

describe('cpLineColorVar', () => {
  it('maps the mvf mountain/valley/edge/flat basics to fold vars', () => {
    expect(cpLineColorVar('Red1', 'mvf')).toBe('--fold-mountain');
    expect(cpLineColorVar('Blue2', 'mvf')).toBe('--fold-valley');
    expect(cpLineColorVar('Black0', 'mvf')).toBe('--fold-border');
    expect(cpLineColorVar('Cyan3', 'mvf')).toBe('--fold-flat');
  });

  it('maps unassigned and named palette colours', () => {
    expect(cpLineColorVar('None', 'mvf')).toBe('--fold-unassigned');
    expect(cpLineColorVar('Purple8', 'mvf')).toBe('--cp-color-purple');
  });

  it('returns null for agrh (kind) classes this step does not resolve', () => {
    expect(cpLineColorVar('Red1', 'agrh')).toBeNull();
  });
});

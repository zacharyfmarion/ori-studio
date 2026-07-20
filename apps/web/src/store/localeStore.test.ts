import { describe, expect, it } from 'vitest';
import { normalizeLocale } from './localeStore';

describe('normalizeLocale', () => {
  it('keeps exact supported codes', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('pt-BR')).toBe('pt-BR');
  });

  it('maps region variants to the supported base', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr-CA')).toBe('fr');
    expect(normalizeLocale('de-AT')).toBe('de');
  });

  it('maps a bare base to the supported regional code', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('pt')).toBe('pt-BR');
  });

  it('falls back to English for unsupported or empty input', () => {
    expect(normalizeLocale('xx')).toBe('en');
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
  });
});

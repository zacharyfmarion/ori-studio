import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { cornerName, diagonalName, edgeName, letteredName } from './referenceNames';

/** The English default, with its `{{name}}` interpolations applied. */
const t = ((_key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? `{{${name}}}`)
  )) as unknown as TFunction;

describe('the sheet’s own references', () => {
  it('names an edge by its side', () => {
    expect(edgeName(t, 'bottom')).toBe('the bottom edge');
    expect(edgeName(t, 'top')).toBe('the top edge');
    expect(edgeName(t, 'left')).toBe('the left edge');
    expect(edgeName(t, 'right')).toBe('the right edge');
  });

  it('names a corner by where it is, not by its compass point', () => {
    expect(cornerName(t, 'sw')).toBe('the bottom-left corner');
    expect(cornerName(t, 'se')).toBe('the bottom-right corner');
    expect(cornerName(t, 'nw')).toBe('the top-left corner');
    expect(cornerName(t, 'ne')).toBe('the top-right corner');
  });

  it('names a diagonal by the corners it joins', () => {
    expect(diagonalName(t, 'sw_ne')).toBe('the bottom-left to top-right diagonal');
    expect(diagonalName(t, 'nw_se')).toBe('the top-left to bottom-right diagonal');
  });
});

describe('letteredName', () => {
  it('says what kind of reference the letter is', () => {
    expect(letteredName(t, 'line', 'B')).toBe('line B');
    expect(letteredName(t, 'point', 'Q')).toBe('point Q');
  });
});

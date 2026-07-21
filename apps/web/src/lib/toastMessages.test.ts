import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { formatUnknownError, humanizeError } from './toastMessages';

// Stand-in that returns the English fallback, like i18next with a missing key.
const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('toast message helpers', () => {
  it('formats error-like values for global error toasts', () => {
    expect(formatUnknownError(new Error('boom'))).toBe('boom');
    expect(formatUnknownError({ message: 'bad fold' })).toBe('bad fold');
    expect(formatUnknownError('plain failure')).toBe('plain failure');
  });

  it('humanizes structural fold error codes', () => {
    expect(
      humanizeError({ code: 'fold_same_parity', message: 'InitialHierarchy(...)' }, t)
    ).toContain("can't be folded flat");
    expect(
      humanizeError({ code: 'fold_layer_search', message: 'WorkerOverlap(SubFace(...))' }, t)
    ).toContain("couldn't be folded");
  });

  it('falls back to the raw message for unknown codes', () => {
    expect(humanizeError({ code: 'some_other_error', message: 'raw detail' }, t)).toBe('raw detail');
    expect(humanizeError(new Error('boom'), t)).toBe('boom');
  });
});

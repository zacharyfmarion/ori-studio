import { expect, it, vi } from 'vitest';
import { bytesToBase64 } from './base64';
it('uses native byte encoding when available and retains the identical chunked fallback', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
  const expected = Buffer.from(bytes).toString('base64');
  Object.defineProperty(bytes, 'toBase64', { value: undefined, configurable: true });
  expect(bytesToBase64(bytes)).toBe(expected);
  const native = vi.fn(() => expected);
  Object.defineProperty(bytes, 'toBase64', { value: native, configurable: true });
  expect(bytesToBase64(bytes)).toBe(expected);
  expect(native).toHaveBeenCalledOnce();
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboardText';

function stubAsyncClipboard(impl: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, 'clipboard', {
    value: impl ? { writeText: impl } : undefined,
    configurable: true,
  });
}

afterEach(() => {
  stubAsyncClipboard(null);
  vi.restoreAllMocks();
});

describe('copyTextToClipboard', () => {
  it('uses the async clipboard when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubAsyncClipboard(writeText);
    await expect(copyTextToClipboard('0.7071')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('0.7071');
  });

  it('falls back when the async clipboard is denied, so the copy still lands', async () => {
    stubAsyncClipboard(() => Promise.reject(new Error('NotAllowedError')));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    await expect(copyTextToClipboard('45')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('leaves no textarea behind after the fallback', async () => {
    stubAsyncClipboard(() => Promise.reject(new Error('NotAllowedError')));
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    await copyTextToClipboard('45');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('reports failure when both paths fail, so the caller can say so', async () => {
    stubAsyncClipboard(() => Promise.reject(new Error('NotAllowedError')));
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
    await expect(copyTextToClipboard('45')).resolves.toBe(false);
  });
});

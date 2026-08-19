import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CpShareError,
  createCpShare,
  fetchCpShare,
  fetchCpShareWithRetry,
  readRememberedAuthor,
  rememberAuthor,
  uploadCpShareThumbnail,
} from './cpShareService';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('createCpShare', () => {
  it('posts the payload and returns the link', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        id: 'a3bK9xmQ',
        url: 'https://ori.studio/s/a3bK9xmQ',
        thumbnailUploadToken: 'tok',
      }),
    );

    const result = await createCpShare({ payload: 'T0NTMQEB', title: 'Bird base', author: 'Zach' });

    expect(result.url).toBe('https://ori.studio/s/a3bK9xmQ');
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      payload: 'T0NTMQEB',
      title: 'Bird base',
      author: 'Zach',
    });
  });

  it('surfaces the Worker code so the toast can say something specific', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Too many share links.', code: 'rate_limited' }, 429),
    );

    // The code, not just the status, is what distinguishes "wait a few minutes" from
    // "this pattern is too big" — both are refusals the person can act on differently.
    await expect(createCpShare({ payload: 'x', title: '', author: null })).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });

  it('still throws a typed error when the body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>502</html>', { status: 502 }),
    );
    const error = await createCpShare({ payload: 'x', title: '', author: null }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CpShareError);
    expect((error as CpShareError).status).toBe(502);
  });
});

describe('fetchCpShare', () => {
  it('encodes the id rather than interpolating it raw', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ id: 'a', payload: 'p', title: '', author: null, createdAt: '' }),
      );
    await fetchCpShare('../../etc');
    expect(String(fetchSpy.mock.calls[0][0])).toContain(encodeURIComponent('../../etc'));
  });

  it('throws with the not_found code for a missing share', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'gone', code: 'not_found' }, 404),
    );
    await expect(fetchCpShare('a3bK9xmQ')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('uploadCpShareThumbnail', () => {
  it('sends the token as a bearer credential and the PNG as the body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await uploadCpShareThumbnail('a3bK9xmQ', png, 'tok');

    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
    expect(init?.body).toBe(png);
  });

  it('rejects on failure so the caller can log and move on', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'nope', code: 'conflict' }, 409),
    );
    await expect(uploadCpShareThumbnail('a3bK9xmQ', new Blob([]), 'tok')).rejects.toBeInstanceOf(
      CpShareError,
    );
  });
});

describe('remembered author', () => {
  it('round-trips through the storage registry', () => {
    expect(readRememberedAuthor()).toBe('');
    rememberAuthor('  Zachary Marion  ');
    expect(readRememberedAuthor()).toBe('Zachary Marion');
  });
});

describe('fetchCpShareWithRetry', () => {
  const share = { id: 'a', payload: 'p', title: '', author: null, createdAt: '' };

  it('retries a 404 until the share appears', async () => {
    // The propagation case: the link is real, this colo just has not seen the write.
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'gone', code: 'not_found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ error: 'gone', code: 'not_found' }, 404))
      .mockResolvedValueOnce(jsonResponse(share));

    const pending = fetchCpShareWithRetry('a3bK9xmQwe');
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toMatchObject({ payload: 'p' });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry anything a wait cannot fix', async () => {
    // A 503 lasts until 00:00 UTC and a 400 is permanent; retrying either just makes the
    // person wait a minute for the same answer.
    for (const status of [400, 429, 503]) {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ error: 'nope', code: 'x' }, status));
      await expect(fetchCpShareWithRetry('a3bK9xmQwe')).rejects.toMatchObject({ status });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    }
  });

  it('gives up after the retry window and reports the 404', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ error: 'gone', code: 'not_found' }, 404));

    const pending = fetchCpShareWithRetry('a3bK9xmQwe');
    const assertion = expect(pending).rejects.toMatchObject({ status: 404 });
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    // Seven attempts: the first plus one per backoff step.
    expect(fetchSpy).toHaveBeenCalledTimes(7);
    vi.useRealTimers();
  });
});

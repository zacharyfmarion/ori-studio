import { afterEach, describe, expect, it, vi } from 'vitest';
import { installModulePreloadPolyfill, type ModulePreloadEnvironment } from './modulePreloadPolyfill';

type Link = ReturnType<ModulePreloadEnvironment['links']> extends Iterable<infer L> ? L : never;

function link(href: string, crossOrigin: string | null = null): Link {
  return { href, integrity: '', referrerPolicy: '', crossOrigin };
}

function environment(supported: boolean, links: Link[], fetch: ModulePreloadEnvironment['fetch']) {
  let added: ((link: Link) => void) | null = null;
  const env: ModulePreloadEnvironment = {
    supported,
    links: () => links,
    observe: (onLink) => {
      added = onLink;
    },
    fetch,
  };
  return { env, add: (next: Link) => added?.(next) };
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  unhandled.length = 0;
});

describe('installModulePreloadPolyfill', () => {
  it('drops a preload that failed instead of leaving it unhandled (ORI-STUDIO-N)', async () => {
    process.on('unhandledRejection', onUnhandled);
    // A plain function, not `vi.fn`: a spy settles what it returns, which would handle the rejection.
    const asked: string[] = [];
    const fetch = (url: string) => {
      asked.push(url);
      return Promise.reject(new TypeError('Load failed'));
    };
    const { env, add } = environment(false, [link('/assets/a.js')], fetch);
    installModulePreloadPolyfill(env);
    add(link('/assets/b.js'));
    // Long enough for Node to report a rejection nobody handled.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asked).toEqual(['/assets/a.js', '/assets/b.js']);
    expect(unhandled).toEqual([]);
  });

  it('fetches each link once, with the credentials it asks for', () => {
    const fetch = vi.fn(() => Promise.resolve(undefined));
    const first = link('/assets/a.js');
    const { env, add } = environment(false, [first], fetch);
    installModulePreloadPolyfill(env);
    add(first);
    add(link('https://cdn.example/b.js', 'anonymous'));
    expect(fetch.mock.calls).toEqual([
      ['/assets/a.js', { credentials: 'same-origin' }],
      ['https://cdn.example/b.js', { credentials: 'omit' }],
    ]);
  });

  it('does nothing where the browser preloads modules itself', () => {
    const fetch = vi.fn(() => Promise.resolve(undefined));
    const observe = vi.fn();
    installModulePreloadPolyfill({ supported: true, links: () => [link('/assets/a.js')], observe, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it('does nothing outside a document', () => {
    expect(() => installModulePreloadPolyfill(null)).not.toThrow();
  });
});

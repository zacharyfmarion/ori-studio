import { describe, expect, it } from 'vitest';
import { isShellResponse, isStorableResponse, routeRequest, shellEntryPath } from './swRoutes';

const ORIGIN = 'https://oristudio.pages.dev';
const NONE = new Set<string>();

function get(path: string, mode = 'no-cors') {
  return { url: `${ORIGIN}${path}`, method: 'GET', mode };
}

function navigate(path: string) {
  return get(path, 'navigate');
}

describe('routeRequest', () => {
  it('bypasses everything it does not recognize, rather than caching it', () => {
    expect(routeRequest(get('/sw.js'), ORIGIN, NONE)).toBe('bypass');
    expect(routeRequest(get('/_headers'), ORIGIN, NONE)).toBe('bypass');
    expect(routeRequest(get('/models/cp-detector-v2/model.onnx'), ORIGIN, NONE)).toBe('bypass');
    expect(routeRequest(get('/something-added-next-year.json'), ORIGIN, NONE)).toBe('bypass');
  });

  it('bypasses non-GET and cross-origin requests', () => {
    expect(routeRequest({ ...get('/api/cp'), method: 'POST' }, ORIGIN, NONE)).toBe('bypass');
    expect(routeRequest(get('/assets/index-abc.js'), 'https://elsewhere.test', NONE)).toBe(
      'bypass'
    );
    expect(routeRequest({ url: 'not a url', method: 'GET', mode: 'cors' }, ORIGIN, NONE)).toBe(
      'bypass'
    );
  });

  // The share route is a Pages Function that rewrites index.html with the KV
  // payload. Answering it from the cached shell renders an empty editor, and the
  // link looks broken rather than slow.
  it('never intercepts the share route, including as a navigation', () => {
    expect(routeRequest(navigate('/s/abc123'), ORIGIN, NONE)).toBe('bypass');
    expect(routeRequest(navigate('/s'), ORIGIN, NONE)).toBe('bypass');
    expect(routeRequest(get('/s/abc123'), ORIGIN, NONE)).toBe('bypass');
    expect(routeRequest(get('/api/cp/abc123/thumbnail'), ORIGIN, NONE)).toBe('bypass');
  });

  it('does not mistake a path that merely starts with the share prefix', () => {
    expect(routeRequest(navigate('/simulate'), ORIGIN, NONE)).toBe('shell');
    expect(routeRequest(get('/start/penguin-figure.json'), ORIGIN, NONE)).toBe('revalidate');
  });

  it('serves in-scope navigations from the shell strategy', () => {
    for (const path of ['/', '/welcome', '/edit', '/design', '/simulate', '/unknown']) {
      expect(routeRequest(navigate(path), ORIGIN, NONE)).toBe('shell');
    }
  });

  it('treats content-hashed assets as immutable', () => {
    expect(routeRequest(get('/assets/index-CVI1HJC7.js'), ORIGIN, NONE)).toBe('immutable');
    expect(routeRequest(get('/assets/oristudio_cp_wasm_bg-CjkZX1Te.wasm'), ORIGIN, NONE)).toBe(
      'immutable'
    );
  });

  it('never caches the assets the build marked unreachable', () => {
    const detector = '/assets/oristudio_cp_detect_wasm_bg-Al3a_JQh.wasm';
    expect(routeRequest(get(detector), ORIGIN, new Set([detector]))).toBe('bypass');
    expect(routeRequest(get(detector), ORIGIN, NONE)).toBe('immutable');
  });

  it('revalidates the unhashed files under public/, which can change in place', () => {
    for (const path of [
      '/locales/ja/common.json',
      '/landing/app-icon.webp',
      '/icons/icon-192.png',
      '/manifest.webmanifest',
      '/favicon.png',
      '/og-default.png',
    ]) {
      expect(routeRequest(get(path), ORIGIN, NONE)).toBe('revalidate');
    }
  });
});

/** Enough of a `Response` for the two predicates, which read four fields. */
function response(init: Partial<Response> & { contentType?: string }): Response {
  return {
    status: 200,
    type: 'basic',
    redirected: false,
    ...init,
    headers: new Headers(init.contentType ? { 'Content-Type': init.contentType } : {}),
  } as Response;
}

describe('isStorableResponse', () => {
  it('accepts a same-origin 200', () => {
    expect(isStorableResponse(response({}))).toBe(true);
  });

  it('rejects errors, cross-origin and opaque responses', () => {
    expect(isStorableResponse(response({ status: 404 }))).toBe(false);
    expect(isStorableResponse(response({ type: 'cors' }))).toBe(false);
    expect(isStorableResponse(response({ type: 'opaque' }))).toBe(false);
  });

  // Replaying a redirected response to a navigation throws, so one in the cache
  // would break offline start rather than merely miss.
  it('rejects a redirected response', () => {
    expect(isStorableResponse(response({ redirected: true }))).toBe(false);
  });
});

describe('shellEntryPath', () => {
  const shell = (entry: string) =>
    `<!doctype html><html><head><script type="module" crossorigin src="${entry}"></script>` +
    `<link rel="stylesheet" crossorigin href="/assets/index-DanmBOkr.css"></head>` +
    `<body><div id="root"></div></body></html>`;

  // The whole point: the cached shell and this worker come from different builds
  // the moment a deploy lands, because navigation is network first and the worker
  // waits. Asking the manifest passes on a file the shell never loads.
  it('reads the entry out of the shell, not the manifest', () => {
    expect(shellEntryPath(shell('/assets/index-NEWBUILD.js'), '/assets/index-OLD.js')).toBe(
      '/assets/index-NEWBUILD.js'
    );
  });

  it('ignores the stylesheet', () => {
    expect(shellEntryPath(shell('/assets/index-abc.js'), '/fallback.js')).not.toContain('.css');
  });

  it('falls back to the manifest rather than to no offline start', () => {
    expect(shellEntryPath('<html><body>not our shell</body></html>', '/assets/index-abc.js')).toBe(
      '/assets/index-abc.js'
    );
  });
});

describe('isShellResponse', () => {
  it('accepts HTML', () => {
    expect(isShellResponse(response({ contentType: 'text/html; charset=utf-8' }))).toBe(true);
  });

  // A direct navigation to an asset URL is still a navigation. Storing that as
  // the shell would replace the app with a picture next time the network died.
  it('rejects a navigation that did not return HTML', () => {
    expect(isShellResponse(response({ contentType: 'image/png' }))).toBe(false);
    expect(isShellResponse(response({}))).toBe(false);
  });
});

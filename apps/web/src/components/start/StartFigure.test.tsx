import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartFigure } from './StartFigure';

/**
 * The welcome screen's figure, as a failure path.
 *
 * Only one thing is asserted here, and it is the one this component got wrong in
 * production: **no way of failing to start may reject.** The GL module is
 * `import()`ed minutes after the page loaded, under a content-hashed name that a
 * deploy deletes out from under the running tab — and Cloudflare Pages answers
 * the gone chunk with `index.html` at 200 rather than a 404, so the browser
 * refuses it on MIME type. That surfaced as two separate unhandled rejections in
 * Sentry (ORI-STUDIO-5, ORI-STUDIO-6) whose only difference was which engine's
 * wording arrived, and neither had anything to do with the figure.
 *
 * The other three fallback reasons already returned rather than threw, which is
 * exactly why this one is easy to reintroduce: it is the single `await` in
 * `begin` that is not a `try`, and everything around it reads as if it were.
 */

const track = vi.hoisted(() => vi.fn());

vi.mock('../../analytics', () => ({
  track,
  ANALYTICS_EVENTS: { startFigureFallback: 'start figure fallback' },
}));

// Resolves, so the run reaches the dynamic import below rather than short-circuiting
// on `asset_failed` — which would pass this test without ever exercising it.
vi.mock('./startFigureAsset', () => ({
  START_FIGURE: { url: '/start/figure.json', fallbackUrl: '/start/figure.png' },
  loadStartFigureAsset: () =>
    Promise.resolve({
      version: 1,
      source: 'test',
      solution: 0,
      view: { yaw: 0, pitch: -Math.PI / 2 },
    }),
}));

/**
 * A chunk that is no longer on the origin. An async factory that rejects is what
 * a failed `import()` actually is — not a module that exports something broken.
 */
vi.mock('./startFigureMesh', () =>
  Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/mesh.js'))
);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let rejections: unknown[];

function onRejection(event: PromiseRejectionEvent) {
  rejections.push(event.reason);
}

beforeEach(() => {
  track.mockClear();
  rejections = [];
  window.addEventListener('unhandledrejection', onRejection);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  window.removeEventListener('unhandledrejection', onRejection);
  act(() => root.unmount());
  container.remove();
});

/** Let the idle callback, the asset promise and the rejected import all settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('StartFigure when the renderer chunk cannot be fetched', () => {
  it('falls back to the static image instead of rejecting', async () => {
    act(() => root.render(<StartFigure />));
    await settle();

    expect(container.querySelector('.start-figure')?.getAttribute('data-status')).toBe('fallback');
    expect(container.querySelector('.start-figure__fallback')).not.toBeNull();
  });

  it('reports the reason, so a broken deploy is distinguishable from an old GPU', async () => {
    act(() => root.render(<StartFigure />));
    await settle();

    expect(track).toHaveBeenCalledWith('start figure fallback', { reason: 'module_failed' });
  });

  it('leaves no unhandled rejection behind', async () => {
    act(() => root.render(<StartFigure />));
    await settle();

    expect(rejections).toEqual([]);
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_BUILDS, RELEASES_LATEST_URL } from '../../platform/desktopDownload';
import { resetDesktopReleaseCache } from '../../platform/desktopRelease';
import { DownloadPage } from './DownloadPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A release that shipped the Mac pair and Windows, and none of the Linux legs. */
const RELEASE = {
  tag_name: 'v0.4.0',
  assets: [
    { name: 'Ori.Studio_0.4.0_aarch64.dmg', browser_download_url: 'https://example.test/arm.dmg', size: 36432845 },
    { name: 'Ori.Studio_0.4.0_x64.dmg', browser_download_url: 'https://example.test/intel.dmg', size: 28710658 },
    { name: 'Ori.Studio_0.4.0_x64-setup.exe', browser_download_url: 'https://example.test/setup.exe', size: 26522343 },
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/download/']}>
        <DownloadPage />
      </MemoryRouter>
    );
  });
  return container;
}

function buildLinks(): HTMLAnchorElement[] {
  return Array.from(container?.querySelectorAll<HTMLAnchorElement>('a.site-builds__link') ?? []);
}

beforeEach(() => {
  resetDesktopReleaseCache();
  localStorage.clear();
  vi.stubGlobal('navigator', {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    maxTouchPoints: 0,
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('DownloadPage', () => {
  it('lists every build the workflow can produce before the release is known', async () => {
    // The prerendered copy — what a crawler indexes — is this state: no request has been
    // answered, so every platform is named and every link is the releases page.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await render();

    const links = buildLinks();
    expect(links).toHaveLength(DESKTOP_BUILDS.length);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(RELEASES_LATEST_URL);
      expect(link.getAttribute('target')).toBe('_blank');
    }
  });

  it('sharpens to the shipped assets, and drops the legs the release did not ship', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => RELEASE }));

    const rendered = await render();

    const hrefs = buildLinks().map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://example.test/arm.dmg',
      'https://example.test/intel.dmg',
      'https://example.test/setup.exe',
    ]);
    // A file, not a page: no new tab, and a size beside it.
    expect(buildLinks()[0]?.getAttribute('target')).toBeNull();
    expect(rendered.querySelector('.site-builds__size')?.textContent).toMatch(/MB/);
    expect(rendered.textContent).toContain('Latest release: 0.4.0');
  });

  it('has one h1, the masthead and the footer, and a way into the app', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const rendered = await render();

    expect(rendered.querySelectorAll('h1')).toHaveLength(1);
    expect(rendered.querySelector('.site-header')).not.toBeNull();
    expect(rendered.querySelector('.site-footer')).not.toBeNull();
    expect(rendered.querySelector('a[href="/edit"]')).not.toBeNull();
  });
});

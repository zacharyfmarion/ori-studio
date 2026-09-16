import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASES_LATEST_URL } from '../../platform/desktopDownload';
import { resetDesktopReleaseCache } from '../../platform/desktopRelease';
import { DesktopDownloadButton } from './DesktopDownloadButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** Pose as a Mac, the platform the fixture's recommended build is for. */
function poseAsMac(): void {
  vi.stubGlobal('navigator', {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    maxTouchPoints: 0,
  });
}

async function render(className?: string): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<DesktopDownloadButton surface="landing" className={className} />);
  });
  return container;
}

function primary(): HTMLAnchorElement | null {
  return container?.querySelector('a.ui-split-button__primary') ?? null;
}

beforeEach(() => {
  resetDesktopReleaseCache();
  localStorage.clear();
  poseAsMac();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('DesktopDownloadButton', () => {
  it('links to the visitor’s own build once the release resolves', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => RELEASE }));

    const rendered = await render();

    expect(primary()?.getAttribute('href')).toBe('https://example.test/arm.dmg');
    expect(rendered.textContent).toContain('Download for macOS');
  });

  it('still links to the releases page when the release cannot be read', async () => {
    // The button is never hrefless. A rate-limited visitor loses the precision,
    // not the download.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await render();

    expect(primary()?.getAttribute('href')).toBe(RELEASES_LATEST_URL);
    expect(primary()?.getAttribute('target')).toBe('_blank');
  });

  it('does not open a new tab for a file, only for the releases page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => RELEASE }));

    await render();

    // A `.dmg` answers with `Content-Disposition: attachment`, so the visitor
    // stays where they are; `_blank` would leave a dead tab behind.
    expect(primary()?.getAttribute('target')).toBeNull();
  });

  it('puts a caller’s class on its root, which is how it is placed', async () => {
    // The start screen positions this in the corner of the screenful through
    // that class alone — a wrapper would survive into the desktop build, where
    // this renders nothing, and leave its own margin behind as an empty gap.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => RELEASE }));

    const rendered = await render('start-screen__download');

    expect(rendered.querySelector('.ui-split-button.start-screen__download')).not.toBeNull();
  });

  it('renders nothing inside the desktop app', async () => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', { ...window, __TAURI_INTERNALS__: {} });

    const rendered = await render();

    expect(rendered.textContent).toBe('');
  });

  it('asks for no release at all in the desktop app', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    vi.stubGlobal('window', { ...window, __TAURI_INTERNALS__: {} });

    await render();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to a platform-free label where no OS was detected', async () => {
    // An iPad, which reports itself as a Mac but must not be offered a DMG.
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.2 Safari/605.1.15',
      maxTouchPoints: 5,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => RELEASE }));

    const rendered = await render();

    expect(rendered.textContent).toContain('Download the desktop app');
    expect(primary()?.getAttribute('href')).toBe(RELEASES_LATEST_URL);
  });
});

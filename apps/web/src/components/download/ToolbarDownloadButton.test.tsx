import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import { resetDesktopReleaseCache } from '../../platform/desktopRelease';
import { TooltipProvider } from '../ui/Tooltip';
import { ToolbarDownloadButton } from './ToolbarDownloadButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RELEASE = {
  tag_name: 'v0.4.0',
  assets: [
    {
      name: 'Ori.Studio_0.4.0_aarch64.dmg',
      browser_download_url: 'https://example.test/arm.dmg',
      size: 36432845,
    },
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/**
 * Answer the phone query independently of the plain coarse-pointer one, which is
 * a substring of it: a tablet is coarse and is *not* a phone, and conflating the
 * two would make this test unable to tell the surface that keeps the button from
 * the surface that drops it.
 */
function stubViewport(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY ? phone : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

async function render(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <ToolbarDownloadButton />
      </TooltipProvider>
    );
  });
  return container;
}

beforeEach(() => {
  resetDesktopReleaseCache();
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('ToolbarDownloadButton', () => {
  it('offers the desktop builds on a viewport that could run one', async () => {
    stubViewport(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => RELEASE }));

    const rendered = await render();

    expect(rendered.querySelector('button')).not.toBeNull();
  });

  it('renders nothing on a phone, which cannot run any of them', async () => {
    stubViewport(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => RELEASE }));

    const rendered = await render();

    expect(rendered.innerHTML).toBe('');
  });

  it('asks GitHub for nothing on a phone', async () => {
    // The reason the phone check gates the *mount* rather than the markup: a
    // `display: none` — or a null return below the hook — still spends a request
    // on installers the device has no way to use.
    stubViewport(true);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => RELEASE });
    vi.stubGlobal('fetch', fetchImpl);

    await render();

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

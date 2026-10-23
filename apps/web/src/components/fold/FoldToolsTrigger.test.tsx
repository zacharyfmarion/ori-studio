import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import { foldTools } from '../../fold/tools/foldToolState';
import { resetFoldToolFavorites } from '../../fold/tools/foldToolFavorites';
import { byRole, queryByRole } from '../../test/roleQueries';
import { FoldToolsTrigger } from './FoldToolsTrigger';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({ opened: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  trackFoldToolPickerOpened: analytics.opened,
}));

vi.mock('../../fold/session/useFoldSession', () => ({
  useFoldSessionState: (selector: (snapshot: unknown) => unknown) => selector({ readOnly: false, cursor: null }),
  useFoldCursor: () => ({ status: 'ready' }),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function stubPhone(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone && (query === PHONE_MEDIA_QUERY || query.includes('pointer: coarse')),
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

function mount(): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<FoldToolsTrigger />));
  return host;
}

beforeEach(() => {
  foldTools().selectTool('valley');
  analytics.opened.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  resetFoldToolFavorites();
});

describe('FoldToolsTrigger', () => {
  it('is the phone’s Tools pill: it opens the tool sheet, once per visit, and closes on a pick', () => {
    stubPhone(true);
    const header = mount();
    const pill = byRole(header, 'button', 'Tools');
    expect(pill.getAttribute('aria-haspopup')).toBe('dialog');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    act(() => pill.click());
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    const sheet = document.getElementById(pill.getAttribute('aria-controls') ?? '');
    expect(sheet?.getAttribute('aria-label')).toBe('Fold tools');
    expect(analytics.opened).toHaveBeenCalledTimes(1);
    // A pick from the sheet takes the tool in hand and closes it.
    const row = sheet?.querySelector<HTMLButtonElement>('[data-fold-tool="mountain"] [data-tool-item]');
    act(() => row?.click());
    expect(foldTools().store.getState().tool).toBe('mountain');
    expect(queryByRole(document.body, 'dialog', 'Fold tools')).toBeNull();
  });

  it('is not there off the phone layout, where the rail is', () => {
    stubPhone(false);
    const header = mount();
    expect(queryByRole(header, 'button', 'Tools')).toBeNull();
  });
});

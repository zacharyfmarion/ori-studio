import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONE_MEDIA_QUERY } from '../platform/phoneLayout';
import {
  phoneScreen,
  usePhoneListDetail,
  type PhoneListDetail,
  type PhoneListDetailView,
} from './usePhoneListDetail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The layout is a media query, which jsdom cannot answer. Stubbed rather than
 * mocked away so the off-phone case runs through the same predicate the
 * desktop does.
 */
function stubLayout(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY ? phone : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: PhoneListDetail | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  vi.unstubAllGlobals();
});

/**
 * Declared once: a component type declared per render would remount and lose
 * the state. Captured in an effect, not during render: `act` flushes effects
 * before it returns, so `latest` is current by the time a test reads it.
 */
function Probe({ view }: { view: PhoneListDetailView }) {
  const flow = usePhoneListDetail(view);
  useEffect(() => {
    latest = flow;
  });
  return null;
}

function render(view: PhoneListDetailView) {
  act(() => root?.render(<Probe view={view} />));
}

const LISTED: PhoneListDetailView = { hasList: true, revision: '1' };
const UNLISTED: PhoneListDetailView = { hasList: false, revision: 'none' };

describe('phoneScreen', () => {
  it('shows the detail when there is no list, whatever was chosen', () => {
    expect(phoneScreen({ screen: 'list', revision: 'none' }, UNLISTED)).toBe('detail');
    expect(phoneScreen({ screen: 'detail', revision: 'none' }, UNLISTED)).toBe('detail');
  });

  it('returns to the list when the document the choice was made for is gone', () => {
    expect(phoneScreen({ screen: 'detail', revision: '1' }, { ...LISTED, revision: '2' })).toBe(
      'list'
    );
  });

  it('keeps the choice for the document it was made for', () => {
    expect(phoneScreen({ screen: 'detail', revision: '1' }, LISTED)).toBe('detail');
    expect(phoneScreen({ screen: 'list', revision: '1' }, LISTED)).toBe('list');
  });
});

describe('usePhoneListDetail', () => {
  it('starts on the list, with nowhere to go back to', () => {
    stubLayout(true);
    render(LISTED);
    expect(latest?.screen).toBe('list');
    expect(latest?.back).toBeNull();
  });

  it('opens the detail and answers that it did, then goes back', () => {
    stubLayout(true);
    render(LISTED);
    let opened: boolean | undefined;
    act(() => {
      opened = latest?.openDetail();
    });
    expect(opened).toBe(true);
    expect(latest?.screen).toBe('detail');
    expect(latest?.back).not.toBeNull();
    act(() => latest?.back?.());
    expect(latest?.screen).toBe('list');
    expect(latest?.back).toBeNull();
  });

  it('shows the detail without a list, with no Back, and the list once one arrives', () => {
    stubLayout(true);
    render(UNLISTED);
    expect(latest?.screen).toBe('detail');
    expect(latest?.back).toBeNull();
    render(LISTED);
    expect(latest?.screen).toBe('list');
  });

  // A new file, an edit that reshapes the patterns, or the document closing:
  // the pattern the detail was opened for may no longer exist, so the list is
  // the only honest screen — and it is the list on the same render, with no
  // frame of the stale detail.
  it('returns to the list when the document changes under the detail', () => {
    stubLayout(true);
    render(LISTED);
    act(() => latest?.openDetail());
    expect(latest?.screen).toBe('detail');
    render({ ...LISTED, revision: '2' });
    expect(latest?.screen).toBe('list');
    // And can be opened again for the new document.
    act(() => latest?.openDetail());
    expect(latest?.screen).toBe('detail');
  });

  it('answers null off the phone, where nothing opens because nothing is hidden', () => {
    stubLayout(false);
    render(LISTED);
    expect(latest?.screen).toBeNull();
    expect(latest?.back).toBeNull();
    let opened: boolean | undefined;
    act(() => {
      opened = latest?.openDetail();
    });
    expect(opened).toBe(false);
    expect(latest?.screen).toBeNull();
  });
});

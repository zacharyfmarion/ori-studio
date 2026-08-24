import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analytics')>();
  return { ...actual, track: analytics.track };
});

import { TooltipProvider } from '../../components/ui/Tooltip';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import { useLayoutStore } from '../../store/layoutStore';
import type { OristudioCpActionDefinition } from '../../lib/oristudioCpActions';
import { resetShiftLatch } from '../touchModifiers/shiftLatch';
import { CpToolsTrigger } from './CpToolsTrigger';
import { publishCpToolSurface, resetCpToolSurface } from './cpToolSurface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The Eraser's rail button. Ids are the kernel operation, kebab-cased. */
const ERASER_ACTION_ID = 'cp.action.line-segment-delete';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let unpublish: (() => void) | null = null;
let phone = true;
const mediaListeners = new Set<() => void>();

/**
 * Answer both media queries independently, because the whole point of the layout
 * predicate is that it is *not* the coarse-pointer one: a tablet is coarse and
 * not a phone, and this button must tell them apart.
 */
function stubMedia(initialPhone: boolean) {
  phone = initialPhone;
  mediaListeners.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        if (query === PHONE_MEDIA_QUERY) return phone;
        return query.includes('pointer: coarse');
      },
      addEventListener: (_type: string, listener: () => void) => void mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        void mediaListeners.delete(listener),
    }))
  );
}

/** What a rotation into a tablet-sized viewport looks like to the app. */
function resize(nextPhone: boolean) {
  phone = nextPhone;
  act(() => {
    for (const listener of [...mediaListeners]) listener();
  });
}

const selected: OristudioCpActionDefinition[] = [];

function publish(
  activeActionId: Parameters<typeof publishCpToolSurface>[0]['activeActionId'] = ERASER_ACTION_ID,
  activeOperationId: Parameters<typeof publishCpToolSurface>[0]['activeOperationId'] = null
) {
  unpublish = publishCpToolSurface({
    activeActionId,
    activeOperationId,
    activeLineColor: 'Red1',
    onSelectAction: (action) => selected.push(action),
  });
}

function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <CpToolsTrigger />
      </TooltipProvider>
    );
  });
}

const trigger = () => container?.querySelector<HTMLButtonElement>('.cp-tools-trigger');
/** Portaled to `document.body`, out of the pill lane — see `CpToolsTrigger`. */
const sheet = () => document.querySelector<HTMLElement>('.cp-tool-picker');

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  unpublish?.();
  unpublish = null;
  selected.length = 0;
  resetCpToolSurface();
  resetShiftLatch();
  useLayoutStore.setState({ activeWorkspace: 'design' });
  analytics.track.mockClear();
  vi.unstubAllGlobals();
});

describe('CpToolsTrigger gating', () => {
  it('offers the tools on a phone in the Edit workspace', () => {
    stubMedia(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    publish();
    render();

    expect(trigger()?.textContent).toContain('Tools');
  });

  it('is absent on a tablet, which still has the rail', () => {
    // Coarse but not phone-sized: the pointer predicate says yes and the layout
    // predicate says no, and this button follows the layout one.
    stubMedia(false);
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    publish();
    render();

    expect(trigger()).toBeNull();
  });

  it('is absent outside the Edit workspace', () => {
    stubMedia(true);
    useLayoutStore.setState({ activeWorkspace: 'simulate' });
    publish();
    render();

    expect(trigger()).toBeNull();
  });

  it('is absent with no crease pattern open', () => {
    stubMedia(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    render();

    expect(trigger()).toBeNull();
  });

  it('takes the sheet with it when the viewport stops being a phone', () => {
    stubMedia(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    publish();
    render();
    act(() => trigger()?.click());
    expect(sheet()).not.toBeNull();

    resize(false);

    expect(trigger()).toBeNull();
    expect(sheet()).toBeNull();
  });
});

describe('CpToolsTrigger active tool', () => {
  it('draws the armed tool, so the canvas says what it will do', () => {
    stubMedia(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    publish(ERASER_ACTION_ID);
    render();

    // Eraser has no Oriedita glyph, so it falls through to its Lucide icon; the
    // assertion worth making is that *something* tool-specific is drawn beside
    // the word, not which font it came out of.
    expect(trigger()?.querySelector('.cp-tools-trigger__glyph')).not.toBeNull();
  });

  it('falls back to the resting tool when nothing is armed', () => {
    stubMedia(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    publish(null, null);
    render();

    expect(trigger()?.querySelector('.cp-tools-trigger__glyph')).not.toBeNull();
  });
});

describe('CpToolsTrigger sheet', () => {
  function open() {
    stubMedia(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    publish();
    render();
    act(() => trigger()?.click());
  }

  it('opens the picker and reports it once', () => {
    open();

    expect(sheet()).not.toBeNull();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith('cp tool picker opened');

    // Reachable by keyboard while the backdrop blocks the tap, and an inflated
    // count is the one failure that would stop the event answering its question.
    act(() => trigger()?.click());
    expect(analytics.track).toHaveBeenCalledTimes(1);
  });

  it('arms the tool it was asked for and closes', () => {
    open();

    const rows = [...(sheet()?.querySelectorAll('.cp-tool-picker__item') ?? [])];
    const eraser = rows.find((row) => row.textContent?.includes('Eraser'));
    if (!(eraser instanceof HTMLElement)) throw new Error('no Eraser row');
    act(() => {
      eraser.click();
    });

    expect(selected.map((action) => action.id)).toEqual([ERASER_ACTION_ID]);
    expect(sheet()).toBeNull();
  });

  it('closes on Escape from wherever focus is inside it', () => {
    open();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

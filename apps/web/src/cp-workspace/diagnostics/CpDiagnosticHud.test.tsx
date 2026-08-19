import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { visibleCpDiagnosticEntries } from './visibleEntries';
import { CpDiagnosticHud } from './CpDiagnosticHud';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The virtualizer observes its scroll element; jsdom has no ResizeObserver.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

// No `rule`/`violation_color`, so `cpDiagnosticEntryMessage` falls back to the
// kernel message — which is the id here, making rows identifiable by entry.
function entry(id: string): OristudioCpDiagnosticEntry {
  return { id, kind: 'CheckCamv', severity: 'error', message: id, point: { x: 0, y: 0 } };
}

function result(operation: string, ids: string[]): OristudioCpCommandResult {
  return {
    operation,
    status: 'OracleTested',
    // Non-empty: `diagnosticHudStatus` returns null without it, and the HUD
    // renders nothing without a status.
    diagnostics: [`${operation} found ${ids.length} issue(s)`],
    diagnostic_entries: ids.map(entry),
  } as OristudioCpCommandResult;
}

function renderHud(options: {
  camvResult?: OristudioCpCommandResult | null;
  lastCommandResult?: OristudioCpCommandResult | null;
  camvIssuesVisible?: boolean;
}) {
  const initial = useWorkspaceStore.getInitialState();
  useWorkspaceStore.setState(
    {
      ...initial,
      oristudioCpCamvResult: options.camvResult ?? null,
      oristudioCpDocument: {
        lastCommandResult: options.lastCommandResult ?? null,
      } as unknown as (typeof initial)['oristudioCpDocument'],
      oristudioCpViewport: {
        ...initial.oristudioCpViewport,
        camvIssuesVisible: options.camvIssuesVisible ?? true,
      },
    },
    true,
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<CpDiagnosticHud />);
  });
  return container;
}

/**
 * jsdom gives every element a zero-size box, so the virtualizer would see a
 * viewport of height 0 and mount nothing at all.
 *
 * Both measurements it takes go through `offsetWidth`/`offsetHeight` — the
 * scroll element's, via virtual-core's `getRect`, and each row's, via
 * `measureElement`. Patched on the prototype rather than on instances because
 * the list does not exist until the HUD is expanded, and by then the
 * measurement has already happened.
 *
 * The numbers are the stylesheet's: `.cp-diagnostic-hud__list` caps at 320px,
 * and a one-line row is ~29px.
 */
const LIST_VIEWPORT_PX = 320;
const ROW_PX = 29;

const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const realClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const realScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

function heightFor(element: HTMLElement): number {
  if (element.classList?.contains('cp-diagnostic-hud__list')) return LIST_VIEWPORT_PX;
  if (element.classList?.contains('cp-diagnostic-hud__row')) return ROW_PX;
  // The spacer's height is the virtualizer's own total, set inline.
  if (element.classList?.contains('cp-diagnostic-hud__spacer')) {
    return Number.parseFloat(element.style.height || '0');
  }
  return 0;
}

/** Content height: for the scroll container, that is its spacer child. */
function scrollHeightFor(element: HTMLElement): number {
  if (element.classList?.contains('cp-diagnostic-hud__list')) {
    const spacer = element.querySelector<HTMLElement>('.cp-diagnostic-hud__spacer');
    return spacer ? heightFor(spacer) : 0;
  }
  return heightFor(element);
}

const realScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');

/**
 * jsdom does no layout, so its `scrollTop` setter is a no-op that always reads
 * back 0. Backed by a real value here so `scrollListTo` can move the list.
 */
const scrollOffsets = new WeakMap<Element, number>();

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return scrollOffsets.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      scrollOffsets.set(this, value);
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return heightFor(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return heightFor(this) > 0 ? 400 : 0;
    },
  });
  // The virtualizer clamps every scroll target to
  // `scrollHeight - clientHeight`. Both are 0 in jsdom, so without these
  // `scrollToIndex` computes the right offset and then clamps it to 0.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return heightFor(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return scrollHeightFor(this);
    },
  });
});

afterAll(() => {
  if (realScrollTop) Object.defineProperty(Element.prototype, 'scrollTop', realScrollTop);
  if (realOffsetHeight)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
  if (realOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetWidth);
  if (realClientHeight)
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', realClientHeight);
  if (realScrollHeight)
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', realScrollHeight);
});

function scrollListTo(view: HTMLElement, top: number) {
  const list = view.querySelector<HTMLElement>('.cp-diagnostic-hud__list');
  if (!list) throw new Error('list not mounted');
  list.scrollTop = top;
  list.dispatchEvent(new Event('scroll'));
}

function expand(view: HTMLElement) {
  const summary = view.querySelector<HTMLButtonElement>('.cp-diagnostic-hud__summary');
  act(() => {
    summary?.click();
  });
}

// The message span only — the glyph carries a <title> that would otherwise land
// in the row's textContent.
function rowIds(view: HTMLElement): string[] {
  return [...view.querySelectorAll('.cp-diagnostic-hud__row')].map(
    (row) => row.querySelector('span')?.textContent?.trim() ?? '',
  );
}

describe('CpDiagnosticHud', () => {
  it('renders nothing when there is no diagnostic result', () => {
    const view = renderHud({});
    expect(view.querySelector('.cp-diagnostic-hud')).toBeNull();
  });

  it('windows a long list: every entry reachable, few rows mounted', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `camv-${i + 1}`);
    const view = renderHud({ camvResult: result('CheckCamv', ids) });
    expand(view);

    // The cap is gone: the scroll extent covers all 2000, not 12.
    const spacer = view.querySelector<HTMLElement>('.cp-diagnostic-hud__spacer');
    const total = Number.parseFloat(spacer?.style.height ?? '0');
    expect(total).toBeGreaterThan(2000 * 20);

    // ...but they are not all in the DOM. A 320px viewport of 29px rows is ~11
    // visible, plus 8 of overscan each way: ~27. The bound is loose enough to
    // survive a row-height tweak and tight enough that dropping the virtualizer
    // (2000 rows) fails it.
    const mounted = view.querySelectorAll('.cp-diagnostic-hud__row').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(60);

    // The last entry is reachable by scrolling, not merely absent.
    act(() => {
      scrollListTo(view, total);
    });
    expect(rowIds(view)).toContain('camv-2000');
  });

  it('shows the same entries the canvas draws when a check result and the overlay coexist', () => {
    // The regression this pins: the list used to pick ONE result — the CAMV
    // overlay here — while the canvas concatenated both. A Check1 marker was
    // drawn, clickable, and framed by the store, with no row to select.
    const camvResult = result('CheckCamv', ['camv-1', 'camv-2']);
    const lastCommandResult = result('Check1', ['check1-1']);
    const view = renderHud({ camvResult, lastCommandResult });
    expand(view);

    const canvasEntries = visibleCpDiagnosticEntries(camvResult, lastCommandResult, true);
    expect(canvasEntries.map((e) => e.id)).toEqual(['camv-1', 'camv-2', 'check1-1']);
    expect(rowIds(view)).toEqual(canvasEntries.map((e) => e.message));
  });

  it('counts the headline over every visible entry, not just the naming result', () => {
    // 21 CAMV errors + 1 Check1 error. The headline counted the naming result's
    // own entries, so it said 21 over a list holding 22.
    const camvResult = result(
      'CheckCamv',
      Array.from({ length: 21 }, (_, i) => `camv-${i + 1}`),
    );
    const lastCommandResult = result('Check1', ['check1-1']);
    const view = renderHud({ camvResult, lastCommandResult });
    expect(view.querySelector('.cp-diagnostic-hud__copy span')?.textContent).toBe(
      '22 Foldability Errors',
    );
  });

  it('drops every row when the foldability toggle hides the overlay', () => {
    const view = renderHud({
      camvResult: result('CheckCamv', ['camv-1']),
      camvIssuesVisible: false,
    });
    expect(view.querySelector('.cp-diagnostic-hud')).toBeNull();
  });

  it('leaves the scroll position alone when the active entry changes', () => {
    // The list does not chase the active id. Nothing outside the list can set it
    // any more, and a CAMV recompute after every edit would otherwise be able to
    // move a list the user had scrolled deliberately.
    const ids = Array.from({ length: 2000 }, (_, i) => `camv-${i + 1}`);
    const view = renderHud({ camvResult: result('CheckCamv', ids) });
    expand(view);
    act(() => {
      scrollListTo(view, 20_000);
    });
    const before = rowIds(view);
    expect(before).not.toContain('camv-1');

    act(() => {
      useWorkspaceStore.getState().setOristudioCpActiveDiagnostic('camv-1');
    });
    expect(rowIds(view)).toEqual(before);
  });

  it('activates the clicked entry', () => {
    const view = renderHud({ camvResult: result('CheckCamv', ['camv-1', 'camv-2']) });
    expand(view);
    const rows = view.querySelectorAll<HTMLButtonElement>('.cp-diagnostic-hud__row');
    act(() => {
      rows[1]?.click();
    });
    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBe('camv-2');
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CpToolHintWindow } from './CpToolHintWindow';
import { CP_TOOL_HINT_OVERHANG, CP_TOOL_HINT_WIDTH } from './toolHintPlacement';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = storageKey(STORAGE_KEYS.cpToolHintCollapsed);

/**
 * jsdom lays nothing out, so the anchor rect has to be stated. The default is
 * the real Edit layout inside jsdom's 1024x768 window: a 260px View pane, so the
 * seam sits at 764. Placing it further left would trip the placement's own
 * right-edge clamp, which `toolHintPlacement.test.ts` covers directly.
 */
const SEAM = 764;

function viewportElement(right = SEAM, bottom = 700): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right, bottom, width: right, height: bottom }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('CpToolHintWindow', () => {
  let host: HTMLElement;
  let root: Root;
  let container: HTMLElement;

  const render = (el: HTMLElement | null = container) =>
    act(() =>
      root.render(
        <CpToolHintWindow container={el} title="Solve Fold Angles" meta="Instructions" ariaLabel="Tool options">
          <p className="probe-body">Pick three creases</p>
        </CpToolHintWindow>
      )
    );

  const windowEl = () => document.querySelector<HTMLElement>('.cp-context-panel');

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    container = viewportElement();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    container.remove();
    localStorage.clear();
  });

  it('portals out of its parent so it can overhang the dock seam', () => {
    render();
    const win = windowEl();
    expect(win).not.toBeNull();
    // The whole point of the portal: it must not be inside the tree that renders
    // it, because both candidate parents clip at the seam.
    expect(host.contains(win)).toBe(false);
    expect(win?.parentElement).toBe(document.body);
  });

  it('positions itself overhanging the seam', () => {
    render();
    const win = windowEl();
    expect(win?.style.left).toBe(`${SEAM - CP_TOOL_HINT_OVERHANG}px`);
    expect(win?.style.width).toBe(`${CP_TOOL_HINT_WIDTH}px`);
  });

  it('renders nothing without a viewport to anchor to', () => {
    render(null);
    expect(windowEl()).toBeNull();
  });

  it('renders nothing while the viewport is laid out but not displayed', () => {
    render(viewportElement(0, 0));
    expect(windowEl()).toBeNull();
  });

  it('collapses to just the header', () => {
    render();
    expect(document.querySelector('.probe-body')).not.toBeNull();

    const header = windowEl()?.querySelector<HTMLButtonElement>('.cp-context-panel__header');
    act(() => header?.click());

    expect(document.querySelector('.probe-body')).toBeNull();
    // Still says what tool it belongs to, which is the point of collapsing to the
    // header rather than hiding the window.
    expect(windowEl()?.textContent).toContain('Solve Fold Angles');
    expect(windowEl()?.textContent).toContain('Instructions');
    expect(header?.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands again', () => {
    localStorage.setItem(KEY, 'true');
    render();
    expect(document.querySelector('.probe-body')).toBeNull();

    act(() => windowEl()?.querySelector<HTMLButtonElement>('.cp-context-panel__header')?.click());
    expect(document.querySelector('.probe-body')).not.toBeNull();
  });

  it('stays collapsed across the unmount every tool switch causes', () => {
    render();
    act(() => windowEl()?.querySelector<HTMLButtonElement>('.cp-context-panel__header')?.click());
    expect(document.querySelector('.probe-body')).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    render();

    expect(windowEl()).not.toBeNull();
    expect(document.querySelector('.probe-body')).toBeNull();
  });

  it('renders a header action beside the header', () => {
    act(() =>
      root.render(
        <CpToolHintWindow
          container={container}
          title="Divide by ratio"
          meta="2 settings"
          ariaLabel="Tool options"
          headerAction={<button className="probe-reset" type="button" />}
        >
          <p />
        </CpToolHintWindow>
      )
    );
    const reset = windowEl()?.querySelector('.probe-reset');
    expect(reset).not.toBeNull();
    expect(reset?.previousElementSibling?.className).toContain('cp-context-panel__header');
  });
});

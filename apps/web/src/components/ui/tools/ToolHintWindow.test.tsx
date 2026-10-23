import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolHintWindow } from './ToolHintWindow';
import { TOOL_HINT_OVERHANG, TOOL_HINT_WIDTH } from './toolHintPlacement';
import { STORAGE_KEYS, storageKey } from '../../../lib/storage';

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

describe('ToolHintWindow', () => {
  let host: HTMLElement;
  let root: Root;
  let container: HTMLElement;

  const render = (el: HTMLElement | null = container) =>
    act(() =>
      root.render(
        <ToolHintWindow container={el} collapseKey={STORAGE_KEYS.cpToolHintCollapsed} title="Solve Fold Angles" meta="Instructions" ariaLabel="Tool options">
          <p className="probe-body">Pick three creases</p>
        </ToolHintWindow>
      )
    );

  const windowEl = () => document.querySelector<HTMLElement>('section[aria-label]');

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
    expect(win?.style.left).toBe(`${SEAM - TOOL_HINT_OVERHANG}px`);
    expect(win?.style.width).toBe(`${TOOL_HINT_WIDTH}px`);
  });

  it('renders nothing without a viewport to anchor to', () => {
    render(null);
    expect(windowEl()).toBeNull();
  });

  it('keeps to its default height unless asked to cap it, as a phone canvas whose paper must stay in view does', () => {
    render();
    expect(windowEl()?.hasAttribute('data-height')).toBe(false);
    act(() =>
      root.render(
        <ToolHintWindow
          container={container}
          collapseKey={STORAGE_KEYS.cpToolHintCollapsed}
          title="Fold"
          meta="Instructions"
          ariaLabel="Tool options"
          height="capped"
        >
          <p>Pick the layers</p>
        </ToolHintWindow>
      )
    );
    expect(windowEl()?.getAttribute('data-height')).toBe('capped');
  });

  it('renders nothing while the viewport is laid out but not displayed', () => {
    render(viewportElement(0, 0));
    expect(windowEl()).toBeNull();
  });

  it('collapses to just the header', () => {
    render();
    expect(document.querySelector('.probe-body')).not.toBeNull();

    const header = windowEl()?.querySelector<HTMLButtonElement>('button[aria-expanded]');
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

    act(() => windowEl()?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click());
    expect(document.querySelector('.probe-body')).not.toBeNull();
  });

  it('stays collapsed across the unmount every tool switch causes', () => {
    render();
    act(() => windowEl()?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click());
    expect(document.querySelector('.probe-body')).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    render();

    expect(windowEl()).not.toBeNull();
    expect(document.querySelector('.probe-body')).toBeNull();
  });

  const renderWith = (props: { startsCollapsed?: boolean; needsAttention?: boolean }) =>
    act(() =>
      root.render(
        <ToolHintWindow
          container={container}
          collapseKey={STORAGE_KEYS.cpToolHintCollapsed}
          title="Valley fold"
          meta="3 settings"
          ariaLabel="Tool options"
          {...props}
        >
          <p className="probe-body">Pick which layers move</p>
        </ToolHintWindow>
      )
    );
  const toggle = () => act(() => windowEl()?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click());
  const open = () => document.querySelector('.probe-body') !== null;

  it('starts collapsed when told to, and keeps a choice once made', () => {
    renderWith({ startsCollapsed: true });
    expect(open()).toBe(false);
    toggle();
    expect(open()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('false');
    // A choice made is the one read back, whatever the surface would start with.
    act(() => root.unmount());
    root = createRoot(host);
    renderWith({ startsCollapsed: true });
    expect(open()).toBe(true);
  });

  it('opens for a decision, closes for it alone, and is as the preference says once it passes', () => {
    renderWith({ startsCollapsed: true });
    expect(open()).toBe(false);
    renderWith({ startsCollapsed: true, needsAttention: true });
    expect(open()).toBe(true);
    // Closed for this decision: the preference is untouched.
    toggle();
    expect(open()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    toggle();
    expect(open()).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
    // The decision made: collapsed, as preferred.
    renderWith({ startsCollapsed: true, needsAttention: false });
    expect(open()).toBe(false);
    // The next decision opens it again.
    renderWith({ startsCollapsed: true, needsAttention: true });
    expect(open()).toBe(true);
  });

  it('leaves a window someone keeps open as it is, decision or none', () => {
    renderWith({ needsAttention: true });
    expect(open()).toBe(true);
    toggle();
    expect(open()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('true');
  });

  it('renders a header action beside the header', () => {
    act(() =>
      root.render(
        <ToolHintWindow
          container={container}
          collapseKey={STORAGE_KEYS.cpToolHintCollapsed}
          title="Divide by ratio"
          meta="2 settings"
          ariaLabel="Tool options"
          headerAction={<button className="probe-reset" type="button" />}
        >
          <p />
        </ToolHintWindow>
      )
    );
    const reset = windowEl()?.querySelector('.probe-reset');
    expect(reset).not.toBeNull();
    // Beside the header, never inside it: the header is a button, and cannot
    // nest one.
    expect(reset?.closest('button[aria-expanded]')).toBeNull();
    expect(windowEl()?.contains(reset ?? null)).toBe(true);
  });

  it('hands its frame to a workspace that keeps out from under it, and takes it back as it goes', () => {
    const frames: (HTMLElement | null)[] = [];
    const onFrame = (frame: HTMLElement | null) => frames.push(frame);
    const show = (el: HTMLElement | null) =>
      act(() =>
        root.render(
          <ToolHintWindow container={el} collapseKey={STORAGE_KEYS.cpToolHintCollapsed} title="Valley fold" meta="1 setting" ariaLabel="Tool options" onFrame={onFrame}>
            <p />
          </ToolHintWindow>
        )
      );
    show(container);
    expect(frames).toEqual([windowEl()]);
    // A re-render is not a new frame.
    show(container);
    expect(frames).toHaveLength(1);
    show(null);
    expect(frames).toEqual([expect.any(HTMLElement), null]);
  });
});

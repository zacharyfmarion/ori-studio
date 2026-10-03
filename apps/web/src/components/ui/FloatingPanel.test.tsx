import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FloatingPanel,
  FloatingPanelBody,
  FloatingPanelClose,
  FloatingPanelHeader,
} from './FloatingPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FloatingPanel', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const panel = () => host.querySelector<HTMLElement>('section[aria-label="Probe"]');

  it('names the window in a bar that is not a button when it toggles nothing', () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <FloatingPanel aria-label="Probe">
          <FloatingPanelHeader
            title="Crease angle"
            action={<FloatingPanelClose label="Close crease angle" onClick={onClose} />}
          />
          <FloatingPanelBody>
            <p>content</p>
          </FloatingPanelBody>
        </FloatingPanel>
      )
    );

    expect(panel()?.textContent).toContain('Crease angle');
    expect(panel()?.querySelector('button[aria-expanded]')).toBeNull();
    // No toggle to float over, so the action is not set into the floated slot.
    expect(panel()?.querySelector('[data-header-action]')).toBeNull();

    const close = panel()?.querySelector<HTMLButtonElement>('button[aria-label="Close crease angle"]');
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('makes the bar the collapse toggle, with the action beside it rather than in it', () => {
    const onCollapsedChange = vi.fn();
    act(() =>
      root.render(
        <FloatingPanel aria-label="Probe">
          <FloatingPanelHeader
            title="Divide by ratio"
            meta="2 settings"
            action={<button type="button" data-probe-reset="" />}
            collapsed={false}
            onCollapsedChange={onCollapsedChange}
          />
        </FloatingPanel>
      )
    );

    const toggle = panel()?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.textContent).toContain('Divide by ratio');
    expect(toggle?.textContent).toContain('2 settings');

    // A button cannot nest one, so the action sits in its own slot.
    const reset = panel()?.querySelector('[data-probe-reset]');
    expect(reset?.closest('button[aria-expanded]')).toBeNull();
    expect(reset?.closest('[data-header-action]')).not.toBeNull();

    act(() => toggle?.click());
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('asks to expand when collapsed', () => {
    const onCollapsedChange = vi.fn();
    act(() =>
      root.render(
        <FloatingPanel aria-label="Probe">
          <FloatingPanelHeader title="Box Select" collapsed onCollapsedChange={onCollapsedChange} />
        </FloatingPanel>
      )
    );

    const toggle = panel()?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle?.click());
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  // `useAnimatedHeight` needs the frame, the scroller and the content's own box.
  it('hands its owner the frame, the body and the content', () => {
    const frame = createRef<HTMLElement>();
    const body = createRef<HTMLDivElement>();
    const content = createRef<HTMLDivElement>();
    act(() =>
      root.render(
        <FloatingPanel ref={frame} aria-label="Probe" pin="bottom">
          <FloatingPanelHeader title="Box Select" />
          <FloatingPanelBody ref={body} contentRef={content}>
            <p data-probe-content="">content</p>
          </FloatingPanelBody>
        </FloatingPanel>
      )
    );

    expect(frame.current).toBe(panel());
    expect(frame.current?.dataset.pin).toBe('bottom');
    expect(body.current?.contains(content.current)).toBe(true);
    expect(content.current?.querySelector('[data-probe-content]')).not.toBeNull();
  });
});

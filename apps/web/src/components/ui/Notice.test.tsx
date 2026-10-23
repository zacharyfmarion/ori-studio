import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice, type NoticeAction } from './Notice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (node: ReactNode) => act(() => root.render(node));
const buttons = () => [...host.querySelectorAll('button')];

describe('Notice', () => {
  it('is a polite status with no buttons, as every notice before actions was', () => {
    render(<Notice>Opens read-only.</Notice>);
    const notice = host.querySelector('[role="status"]');
    expect(notice?.getAttribute('data-tone')).toBe('info');
    expect(notice?.textContent).toBe('Opens read-only.');
    expect(buttons()).toEqual([]);

    render(<Notice tone="warning">Two steps will be blank.</Notice>);
    expect(host.querySelector('[role="status"]')?.getAttribute('data-tone')).toBe('warning');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('says a refusal as an alert, so it is announced at once', () => {
    render(<Notice tone="danger">Everything would move.</Notice>);
    const notice = host.querySelector('[role="alert"]');
    expect(notice?.getAttribute('data-tone')).toBe('danger');
    expect(notice?.textContent).toBe('Everything would move.');
    expect(host.querySelector('[role="status"]')).toBeNull();
    // The icon is decoration; the sentence carries the meaning.
    expect(notice?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('offers its fixes as buttons inside the region, in order, each running its own action', () => {
    const include: NoticeAction = { id: 'include', label: 'Include Flap 1', run: vi.fn() };
    const mountain: NoticeAction = { id: 'mountain', label: 'Mountain fold instead', run: vi.fn() };
    render(
      <Notice tone="danger" actions={[include, mountain]}>
        Flap 1 is caught between the layers.
      </Notice>
    );
    const notice = host.querySelector('[role="alert"]');
    expect(buttons().map((button) => [button.textContent, button.type])).toEqual([
      ['Include Flap 1', 'button'],
      ['Mountain fold instead', 'button'],
    ]);
    expect(buttons().every((button) => notice?.contains(button))).toBe(true);
    // Rendering moves no focus: the notice interrupts nothing.
    expect(document.activeElement).toBe(document.body);

    act(() => buttons()[1]!.click());
    expect(mountain.run).toHaveBeenCalledTimes(1);
    // Called bare, not handed the click event.
    expect(mountain.run).toHaveBeenCalledWith();
    expect(include.run).not.toHaveBeenCalled();
  });

  it('shows a disabled fix that does not run', () => {
    const run = vi.fn();
    render(
      <Notice tone="warning" actions={[{ id: 'turn', label: 'Turn over', run, disabled: true }]}>
        The flap is underneath.
      </Notice>
    );
    expect(buttons()[0]!.disabled).toBe(true);
    act(() => buttons()[0]!.click());
    expect(run).not.toHaveBeenCalled();
  });
});

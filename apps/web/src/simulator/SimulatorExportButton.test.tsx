import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../components/ui/Tooltip';
import { SimulatorExportButton } from './SimulatorExportButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(props: { onExport: () => void; disabled?: boolean }): HTMLDivElement {
  act(() => {
    root?.render(
      <TooltipProvider>
        <SimulatorExportButton {...props} />
      </TooltipProvider>
    );
  });
  if (!container) throw new Error('not mounted');
  return container;
}

function trigger(rendered: HTMLElement): HTMLButtonElement {
  const button = rendered.querySelector<HTMLButtonElement>('button[aria-label="Export view…"]');
  if (!button) throw new Error('no export button');
  return button;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('SimulatorExportButton', () => {
  it('is one icon button named by its title, with no menu behind it', () => {
    const rendered = render({ onExport: () => {} });

    expect(rendered.querySelectorAll('button')).toHaveLength(1);
    const button = trigger(rendered);
    expect(button.getAttribute('aria-haspopup')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBeNull();
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.textContent).toBe('');
  });

  it('asks for an export once per press, and opens nothing itself', () => {
    const onExport = vi.fn();
    const rendered = render({ onExport });

    act(() => trigger(rendered).click());
    expect(onExport).toHaveBeenCalledTimes(1);
    act(() => trigger(rendered).click());
    expect(onExport).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('can be switched off, and then asks for nothing', () => {
    const onExport = vi.fn();
    const rendered = render({ onExport, disabled: true });

    const button = trigger(rendered);
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(onExport).not.toHaveBeenCalled();
  });

  it('is enabled unless told otherwise', () => {
    expect(trigger(render({ onExport: () => {} })).disabled).toBe(false);
  });
});

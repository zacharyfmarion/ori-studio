import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulatorToolWindow } from './SimulatorToolWindow';
import type { SimulatorToolWindowModel } from './tools/actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let viewport: HTMLDivElement;

function model(extra: Partial<SimulatorToolWindowModel> = {}): SimulatorToolWindowModel {
  return {
    kind: 'pin',
    title: 'Pin',
    meta: '3 faces pinned',
    instructions: ['Drag a box.', 'Shift adds.'],
    toggles: [{ id: 'pinThroughLayers', label: 'Select through all layers', checked: true, set: vi.fn() }],
    pins: { clearLabel: 'Clear pins', clear: vi.fn() },
    notices: [],
    ...extra,
  };
}

function render(value: SimulatorToolWindowModel | null) {
  act(() => root.render(<SimulatorToolWindow container={viewport} model={value} />));
}

const windowEl = () => document.querySelector<HTMLElement>('section[aria-label="Simulator tool options"]');

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  viewport = document.createElement('div');
  viewport.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 764, bottom: 700, width: 764, height: 700 }) as DOMRect;
  document.body.appendChild(viewport);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  viewport.remove();
  localStorage.clear();
});

describe('SimulatorToolWindow', () => {
  it('shows nothing when the tool has nothing to say', () => {
    render(null);
    expect(windowEl()).toBeNull();
  });

  it('names the tool, says what is pinned, and lists how to use it', () => {
    const value = model();
    render(value);

    expect(windowEl()?.querySelector('button[aria-expanded]')?.textContent).toContain('Pin');
    expect(windowEl()?.textContent).toContain('3 faces pinned');
    expect([...(windowEl()?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'Drag a box.',
      'Shift adds.',
    ]);
  });

  it('switches an option and clears the pins through the model', () => {
    const value = model();
    render(value);

    const toggle = windowEl()?.querySelector<HTMLElement>('[role="switch"]');
    act(() => toggle?.click());
    expect(value.toggles[0]?.set).toHaveBeenCalledWith(false);

    const clear = [...(windowEl()?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Clear pins'
    );
    act(() => clear?.click());
    expect(value.pins?.clear).toHaveBeenCalledTimes(1);
  });

  it('reads its notices out as status, not as errors', () => {
    render(model({ notices: ['Pinned faces are pulling against each other.'] }));

    const status = windowEl()?.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Pinned faces are pulling against each other.');
  });

  it('keeps its collapsed state apart from Edit’s window', () => {
    render(model());
    act(() => windowEl()?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click());

    expect(localStorage.getItem('oristudio:simulator-tool-hint-collapsed')).toBe('true');
    expect(localStorage.getItem('oristudio:cp-tool-hint-collapsed')).toBeNull();
  });
});

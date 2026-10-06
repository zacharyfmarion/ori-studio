import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../components/ui/Tooltip';
import { SimulatorToolRail } from './SimulatorToolRail';
import type { SimulatorToolButton } from './tools/actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function buttons(extra: Partial<Record<SimulatorToolButton['id'], Partial<SimulatorToolButton>>> = {}) {
  const base: SimulatorToolButton[] = [
    {
      id: 'orbit',
      icon: 'orbit',
      label: 'Orbit',
      description: 'Drag to turn the model.',
      shortcut: 'simulator.tool.orbit',
      active: true,
      badge: false,
      select: vi.fn(),
    },
    {
      id: 'pin',
      icon: 'pin',
      label: 'Pin',
      description: 'Hold faces in place.',
      shortcut: 'simulator.tool.pin',
      active: false,
      badge: false,
      select: vi.fn(),
    },
  ];
  return base.map((button) => ({ ...button, ...extra[button.id] }));
}

function render(list: SimulatorToolButton[], disabled = false) {
  act(() =>
    root.render(
      <TooltipProvider>
        <SimulatorToolRail buttons={list} disabled={disabled} />
      </TooltipProvider>
    )
  );
}

const toolbar = () => host.querySelector<HTMLElement>('[role="toolbar"]');
const tool = (name: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SimulatorToolRail', () => {
  it('is a vertical toolbar naming each tool and the one in hand', () => {
    render(buttons());

    expect(toolbar()?.getAttribute('aria-orientation')).toBe('vertical');
    expect(toolbar()?.getAttribute('aria-label')).toBe('Simulator tools');
    expect(tool('Orbit')?.getAttribute('aria-pressed')).toBe('true');
    expect(tool('Pin')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('selects a tool on click', () => {
    const list = buttons();
    render(list);

    act(() => tool('Pin')?.click());

    expect(list[1]?.select).toHaveBeenCalledTimes(1);
  });

  it('keeps one tab stop, on the tool in hand, and moves with the arrows', () => {
    render(buttons({ orbit: { active: false }, pin: { active: true } }));
    expect(tool('Orbit')?.tabIndex).toBe(-1);
    expect(tool('Pin')?.tabIndex).toBe(0);

    act(() => tool('Pin')?.focus());
    act(() => {
      toolbar()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(document.activeElement).toBe(tool('Orbit'));
    act(() => {
      toolbar()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(tool('Pin'));
  });

  it('marks Pin while pins outlive it under another tool', () => {
    render(buttons());
    expect(host.querySelector('[data-tool-badge]')).toBeNull();

    render(buttons({ pin: { badge: true } }));
    expect(host.querySelector('[data-tool-badge]')).not.toBeNull();
  });

  it('disables every tool until the simulation is ready', () => {
    render(buttons(), true);

    expect(tool('Orbit')?.disabled).toBe(true);
    expect(tool('Pin')?.disabled).toBe(true);
  });
});

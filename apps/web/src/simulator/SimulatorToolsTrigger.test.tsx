import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analytics')>();
  return { ...actual, trackSimulatorToolPickerOpened: vi.fn() };
});

import { useLayoutStore } from '../store/layoutStore';
import { SimulatorToolsTrigger } from './SimulatorToolsTrigger';
import type { SimulatorToolButton } from './tools/actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Simulate's Tools pill on a phone, and its sheet: a sheet like every other
 * (rf6) — in the sheet layer, under a dialog opened over it, which then has
 * the Escape.
 */

const buttons: SimulatorToolButton[] = [
  {
    id: 'orbit',
    icon: 'orbit',
    label: 'Orbit',
    description: 'Turn the model',
    shortcut: 'simulator.tool.orbit',
    active: true,
    badge: false,
    select: () => {},
  },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let layer: HTMLDivElement | null = null;
let modals: HTMLDivElement | null = null;

beforeEach(() => {
  // As App lays the document out: the sheet layer, then the modals.
  layer = document.body.appendChild(document.createElement('div'));
  modals = document.body.appendChild(document.createElement('div'));
  useLayoutStore.setState({ sheetLayer: layer });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
  act(() => root?.render(<SimulatorToolsTrigger buttons={buttons} disabled={false} surface="simulate" />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  layer?.remove();
  modals?.remove();
  container = layer = modals = null;
  useLayoutStore.setState({ sheetLayer: null });
});

const trigger = () => container?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
const sheet = () => layer?.querySelector<HTMLElement>('[role="dialog"]') ?? null;
const escape = (target: EventTarget) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

describe('Simulate’s tool sheet', () => {
  it('opens in the sheet layer, under a dialog opened over it, and leaves Escape to that dialog (rf6)', () => {
    act(() => trigger()?.click());
    expect(sheet()).not.toBeNull();
    expect(sheet()?.id).toBe(trigger()?.getAttribute('aria-controls'));

    // A dialog a shortcut opened while the sheet was up: on top, and Escape is its own.
    const dialog = modals!.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    escape(dialog);
    expect(sheet()).not.toBeNull();

    dialog.remove();
    escape(window);
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

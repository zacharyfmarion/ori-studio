import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropertyField, PropertySheet } from '../../lib/propertyDescriptors';
import { PropertySheetView } from './PropertySheetView';

/**
 * The generic renderer: one field of every kind, and the protocol each kind
 * commits through. The assertions are about *when* the descriptor's functions
 * are called — once per recorded change, never per input event — because that
 * is the contract a catalog relies on for "one undo entry per gesture".
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(sheet: PropertySheet, onCommit = vi.fn()) {
  act(() => {
    root?.render(
      <PropertySheetView sheet={sheet} surfaceProps={{ 'data-test-surface': '' }} onCommit={onCommit} />
    );
  });
  return onCommit;
}

function sheetOf(...fields: PropertyField[]): PropertySheet {
  return {
    kind: 'test',
    targetId: 't1',
    title: 'Thing',
    subtitle: '10 × 10',
    icon: 'image',
    sections: [{ id: 'main', fields }],
  };
}

/** The control named `label`, by accessible name or by the row label pointing at it. */
function input(label: string): HTMLInputElement {
  const byName = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (byName) return byName;
  const rowLabel = [...(container?.querySelectorAll<HTMLLabelElement>('label[for]') ?? [])].find(
    (candidate) => candidate.textContent === label
  );
  const element = rowLabel ? document.getElementById(rowLabel.htmlFor) : null;
  expect(element, label).not.toBeNull();
  return element as HTMLInputElement;
}

function fire(element: Element, type: string, init: EventInit = {}) {
  act(() => {
    element.dispatchEvent(new Event(type, { bubbles: true, ...init }));
  });
}

/** Set a native input's value the way a user would, then fire `input`. */
function type(element: HTMLInputElement, value: string, event: 'input' | 'change' = 'input') {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event(event, { bubbles: true }));
  });
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

describe('PropertySheetView', () => {
  it('shows the header and marks the surface', () => {
    render(sheetOf());
    expect(container?.querySelector('.property-sheet')?.getAttribute('data-test-surface')).toBe('');
    expect(container?.querySelector('.property-sheet__title')?.textContent).toBe('Thing');
    expect(container?.querySelector('.property-sheet__subtitle')?.textContent).toBe('10 × 10');
    expect(container?.querySelector('.property-sheet__icon svg')).not.toBeNull();
  });

  it('hides a not-applicable field and disables an unsupported one with its reason', () => {
    render(
      sheetOf(
        {
          id: 'gone',
          kind: 'toggle',
          label: 'Gone',
          support: 'not-applicable',
          protocol: 'discrete',
          value: true,
          commit: vi.fn(),
        },
        {
          id: 'inert',
          kind: 'toggle',
          label: 'Inert',
          support: 'unsupported',
          reason: 'Refold first',
          protocol: 'discrete',
          value: true,
          commit: vi.fn(),
        }
      )
    );
    expect(container?.querySelector('[aria-label="Gone"]')).toBeNull();
    const row = container?.querySelector('.control-row');
    expect(row?.getAttribute('data-disabled')).toBe('true');
    expect(row?.getAttribute('title')).toBe('Refold first');
  });

  it('renders nothing for a section with no visible field', () => {
    render(
      sheetOf({
        id: 'gone',
        kind: 'toggle',
        label: 'Gone',
        support: 'not-applicable',
        protocol: 'discrete',
        value: true,
        commit: vi.fn(),
      })
    );
    expect(container?.querySelector('.property-sheet__section')).toBeNull();
  });

  it('commits a toggle, a select and a segmented control once each, skipping a no-op', () => {
    const toggle = vi.fn();
    const select = vi.fn();
    const segmented = vi.fn();
    const onCommit = render(
      sheetOf(
        {
          id: 'shadows',
          kind: 'toggle',
          label: 'Shadows',
          support: 'supported',
          protocol: 'discrete',
          value: false,
          commit: toggle,
        },
        {
          id: 'style',
          kind: 'select',
          label: 'Style',
          support: 'supported',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          protocol: 'discrete',
          value: 'a',
          commit: select,
        },
        {
          id: 'side',
          kind: 'segmented',
          label: 'Side',
          support: 'supported',
          options: [
            { id: 'front', label: 'Front' },
            { id: 'back', label: 'Back' },
          ],
          protocol: 'discrete',
          value: 'front',
          commit: segmented,
        }
      )
    );

    act(() => container?.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    expect(toggle).toHaveBeenCalledWith(true);

    const options = [...container!.querySelectorAll<HTMLButtonElement>('.segmented__option')];
    act(() => options.find((option) => option.textContent === 'Front')?.click());
    expect(segmented).not.toHaveBeenCalled();
    act(() => options.find((option) => option.textContent === 'Back')?.click());
    expect(segmented).toHaveBeenCalledWith('back');

    // The select's list is portalled and Radix-driven; the row's guard is the
    // same as the segmented one's, pinned through it above.
    expect(select).not.toHaveBeenCalled();
    expect(onCommit.mock.calls.map(([id]) => id)).toEqual(['shadows', 'side']);
  });

  it('commits a number draft on Enter and a text draft on blur, once each', () => {
    const number = vi.fn();
    const text = vi.fn();
    const onCommit = render(
      sheetOf(
        {
          id: 'rotation',
          kind: 'number',
          label: 'Rotation',
          support: 'supported',
          step: 1,
          protocol: 'draft',
          value: 10,
          commit: number,
        },
        {
          id: 'name',
          kind: 'text',
          label: 'Name',
          support: 'supported',
          protocol: 'draft',
          value: 'old',
          commit: text,
        }
      )
    );

    const rotation = input('Rotation');
    act(() => rotation.focus());
    type(rotation, '45');
    act(() =>
      rotation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    );
    expect(number).toHaveBeenCalledTimes(1);
    expect(number).toHaveBeenCalledWith(45);

    const name = input('Name');
    type(name, 'new');
    fire(name, 'focusout');
    expect(text).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith('new');
    expect(onCommit.mock.calls.map(([id]) => id)).toEqual(['rotation', 'name']);
  });

  it('reads a live value for a number row while one moves', () => {
    let current = 30;
    const listeners = new Set<() => void>();
    render(
      sheetOf({
        id: 'yaw',
        kind: 'number',
        label: 'Yaw',
        support: 'supported',
        protocol: 'draft',
        value: 10,
        live: {
          read: () => current,
          subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        commit: vi.fn(),
      })
    );
    expect(input('Yaw').value).toBe('30');
    act(() => {
      current = 31;
      for (const listener of listeners) listener();
    });
    expect(input('Yaw').value).toBe('31');
  });

  it('runs a slider drag as begin once, updates per move, end once', () => {
    const begin = vi.fn(() => true);
    const update = vi.fn();
    const end = vi.fn();
    const onCommit = render(
      sheetOf({
        id: 'opacity',
        kind: 'slider',
        label: 'Opacity',
        support: 'supported',
        undoLabel: 'Adjust opacity',
        min: 0,
        max: 1,
        step: 0.01,
        protocol: 'continuous',
        value: 1,
        begin,
        update,
        end,
        held: false,
      })
    );
    const slider = input('Opacity');
    type(slider, '0.5');
    type(slider, '0.4');
    // The native `change` on release, which carries no new value.
    fire(slider, 'change');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(update.mock.calls.map(([value]) => value)).toEqual([0.5, 0.4]);
    expect(end).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('opacity');
  });

  it('writes nothing through a refused slider begin, and disables a held row', () => {
    const update = vi.fn();
    const end = vi.fn();
    const onCommit = render(
      sheetOf(
        {
          id: 'opacity',
          kind: 'slider',
          label: 'Opacity',
          support: 'supported',
          min: 0,
          max: 1,
          protocol: 'continuous',
          value: 1,
          begin: () => false,
          update,
          end,
          held: false,
        },
        {
          id: 'held',
          kind: 'slider',
          label: 'Held',
          support: 'supported',
          min: 0,
          max: 1,
          protocol: 'continuous',
          value: 1,
          begin: () => true,
          update: vi.fn(),
          end: vi.fn(),
          held: true,
        }
      )
    );
    const slider = input('Opacity');
    type(slider, '0.5');
    fire(slider, 'change');
    expect(update).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input('Held').disabled).toBe(true);
  });

  it('runs a colour pick as begin once, updates per move, end on blur', () => {
    const begin = vi.fn(() => true);
    const update = vi.fn();
    const end = vi.fn();
    const onCommit = render(
      sheetOf({
        id: 'frontColor',
        kind: 'color',
        label: 'Front colour',
        support: 'supported',
        protocol: 'continuous',
        value: '#ffff32',
        begin,
        update,
        end,
        held: false,
      })
    );
    const swatch = input('Front colour');
    type(swatch, '#ff0000', 'change');
    type(swatch, '#00ff00', 'change');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(update.mock.calls.map(([value]) => value)).toEqual(['#ff0000', '#00ff00']);
    expect(end).not.toHaveBeenCalled();

    fire(swatch, 'focusout');
    expect(end).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('frontColor');

    // A blur with nothing picked ends nothing and counts nothing.
    fire(swatch, 'focusout');
    expect(end).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('refuses a colour pick for the whole pick, then asks again on the next', () => {
    let allowed = false;
    const begin = vi.fn(() => allowed);
    const update = vi.fn();
    render(
      sheetOf({
        id: 'frontColor',
        kind: 'color',
        label: 'Front colour',
        support: 'supported',
        protocol: 'continuous',
        value: '#ffff32',
        begin,
        update,
        end: vi.fn(),
        held: false,
      })
    );
    const swatch = input('Front colour');
    type(swatch, '#ff0000', 'change');
    type(swatch, '#00ff00', 'change');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();

    fire(swatch, 'focusout');
    allowed = true;
    type(swatch, '#0000ff', 'change');
    expect(begin).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith('#0000ff');
  });

  it('offers a reset as the row affordance and counts it as a commit', () => {
    const reset = vi.fn();
    const onCommit = render(
      sheetOf({
        id: 'yaw',
        kind: 'number',
        label: 'Yaw',
        support: 'supported',
        protocol: 'draft',
        value: 10,
        reset,
        commit: vi.fn(),
      })
    );
    const button = container?.querySelector<HTMLButtonElement>('.control-row__reset');
    expect(button?.getAttribute('aria-label')).toBe('Reset Yaw to default');
    act(() => button?.click());
    expect(reset).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('yaw');
  });
});

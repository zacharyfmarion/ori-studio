import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollapsibleSection } from '../CollapsibleSection';
import { NumberRow, SegmentedRow, SelectRow, SliderRow, TextRow, ToggleRow } from './index';

/**
 * The shared field-row kit: the shell every options pane's rows share, and the
 * commit protocols a Properties sheet relies on the rows to keep.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(ui);
  });
  return container;
}

function rerender(ui: React.ReactElement) {
  act(() => {
    root?.render(ui);
  });
}

describe('ToggleRow', () => {
  it('never wraps the switch in a label, so a click toggles once', () => {
    const onChange = vi.fn();
    const view = render(<ToggleRow label="Grid" checked={false} onChange={onChange} />);
    const button = view.querySelector<HTMLButtonElement>('button[role="switch"]');
    expect(button).not.toBeNull();
    expect(button?.closest('label')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Grid');
    act(() => button?.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('marks the row disabled, not only the control', () => {
    const view = render(
      <ToggleRow label="Shadows" checked disabled title="Not on a 3D figure" onChange={() => {}} />
    );
    const row = view.querySelector('.control-row');
    expect(row?.getAttribute('data-disabled')).toBe('true');
    expect(row?.getAttribute('title')).toBe('Not on a 3D figure');
  });
});

describe('NumberRow', () => {
  it('points its label at the input and resyncs the draft when the value changes', () => {
    const onCommit = vi.fn();
    const view = render(<NumberRow label="Line width" value={1} onCommit={onCommit} />);
    const label = view.querySelector<HTMLLabelElement>('label.control-row__label');
    const input = view.querySelector<HTMLInputElement>('input');
    expect(label?.htmlFor).toBe(input?.id);
    expect(input?.value).toBe('1');
    rerender(<NumberRow label="Line width" value={3} onCommit={onCommit} />);
    expect(input?.value).toBe('3');
  });
});

describe('SelectRow and SegmentedRow', () => {
  it('render the mixed state as no option chosen', () => {
    const view = render(
      <>
        <SelectRow
          label="Block"
          value={null}
          placeholder="Mixed"
          options={[{ id: 'p', label: 'Paragraph' }]}
          onChange={() => {}}
        />
        <SegmentedRow
          label="Align"
          value={null}
          options={[
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ]}
          onChange={() => {}}
        />
      </>
    );
    expect(view.querySelector('.select-trigger')?.textContent).toContain('Mixed');
    const pressed = [...view.querySelectorAll<HTMLButtonElement>('.segmented__option')].map(
      (button) => button.getAttribute('aria-pressed')
    );
    expect(pressed).toEqual(['false', 'false']);
  });

  it('report the chosen option by id', () => {
    const onChange = vi.fn();
    const view = render(
      <SegmentedRow
        label="Align"
        value="left"
        options={[
          { id: 'left', label: 'Left' },
          { id: 'right', label: 'Right' },
        ]}
        onChange={onChange}
      />
    );
    const buttons = view.querySelectorAll<HTMLButtonElement>('.segmented__option');
    act(() => buttons[1]?.click());
    expect(onChange).toHaveBeenCalledWith('right');
  });
});

describe('SliderRow', () => {
  it('opens the gesture once per drag and commits on the native change', () => {
    const onChange = vi.fn();
    const onGestureStart = vi.fn();
    const onGestureCommit = vi.fn();
    const view = render(
      <SliderRow
        label="Opacity"
        min={0}
        max={100}
        value={50}
        onChange={onChange}
        onGestureStart={onGestureStart}
        onGestureCommit={onGestureCommit}
        commitLabel="Adjust opacity"
      />
    );
    const input = view.querySelector<HTMLInputElement>('input[type="range"]');
    if (!input) throw new Error('no slider');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    for (const value of ['60', '70', '80']) {
      act(() => {
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onGestureCommit).not.toHaveBeenCalled();
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onGestureCommit).toHaveBeenCalledTimes(1);
    expect(onGestureCommit).toHaveBeenCalledWith('Adjust opacity');
    // A second drag is a second gesture.
    act(() => {
      setter?.call(input, '90');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureCommit).toHaveBeenCalledTimes(2);
  });

  it('shows the value with the step\'s decimals', () => {
    const view = render(
      <SliderRow label="Weight" min={0} max={2} step={0.1} value={0.7} onChange={() => {}} />
    );
    expect(view.querySelector('.control-row__readout')?.textContent).toBe('0.7');
  });
});

describe('TextRow', () => {
  it('commits on Enter, reverts on Escape, and refuses an empty draft', () => {
    const onCommit = vi.fn();
    const view = render(<TextRow label="Title" value="Crane" onCommit={onCommit} />);
    const input = view.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('no input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, 'Heron');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith('Heron');
    act(() => {
      setter?.call(input, '   ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('Crane');
  });
});

describe('CollapsibleSection', () => {
  it('folds its body and its header action behind the title', () => {
    const view = render(
      <CollapsibleSection
        title="Paper"
        collapsible
        action={<button type="button">reset</button>}
      >
        <div data-testid="body" />
      </CollapsibleSection>
    );
    expect(view.querySelector('[data-testid="body"]')).toBeNull();
    expect(view.querySelector('.collapsible-section__header button[type="button"]:not(.collapsible-section__toggle)')).toBeNull();
    const toggle = view.querySelector<HTMLButtonElement>('.collapsible-section__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(view.querySelector('[data-testid="body"]')).not.toBeNull();
    expect(view.querySelector('.collapsible-section')?.getAttribute('data-open')).toBe('true');
  });

  it('is always open, with no toggle, when not collapsible', () => {
    const view = render(
      <CollapsibleSection title="Render">
        <div data-testid="body" />
      </CollapsibleSection>
    );
    expect(view.querySelector('.collapsible-section__toggle')).toBeNull();
    expect(view.querySelector('[data-testid="body"]')).not.toBeNull();
  });
});

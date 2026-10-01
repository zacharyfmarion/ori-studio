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

  // A reset button beside a switch came and went as the switch was flipped,
  // moving the switch under the pointer; the second of two quick clicks hit
  // the reset. An overridden toggle says so under its label instead.
  it('says "Overridden" under the label instead of offering a reset button', () => {
    const view = render(
      <ToggleRow label="Lighting" checked inherited={false} onChange={() => {}} />
    );
    const switchOf = () => view.querySelector<HTMLButtonElement>('button[role="switch"]');
    expect(view.querySelector('.control-row__note')?.textContent).toBe('');
    expect(switchOf()?.hasAttribute('aria-describedby')).toBe(false);

    rerender(
      <ToggleRow label="Lighting" checked inherited={false} onChange={() => {}} onReset={() => {}} />
    );
    expect(view.querySelector('.control-row__reset')).toBeNull();
    expect(view.querySelector('button[aria-label="Reset Lighting to default"]')).toBeNull();
    const note = view.querySelector('.control-row__note');
    expect(note?.textContent).toBe('Overridden');
    // Read with the switch, not only seen beside it.
    expect(note?.id).toBeTruthy();
    expect(switchOf()?.getAttribute('aria-describedby')).toBe(note?.id);
  });

  it('keeps the switch where it was: the note takes a line of its own, never the value column', () => {
    const view = render(<ToggleRow label="Lighting" checked onChange={() => {}} />);
    const row = view.querySelector('.control-row')!;
    const value = view.querySelector('.control-row__value')!;
    const before = value.className;
    expect(row.classList.contains('control-row--noted')).toBe(false);

    rerender(<ToggleRow label="Lighting" checked onChange={() => {}} onReset={() => {}} />);
    // The same value box holding the switch alone, so the column is as wide
    // as it was; the note follows it in the row, which puts it on the grid's
    // second line under the label.
    expect(value.className).toBe(before);
    expect([...value.children].map((child) => child.getAttribute('role'))).toEqual(['switch']);
    expect([...row.children].map((child) => child.className)).toEqual([
      'control-row__label',
      before,
      'control-row__note',
    ]);
    expect(row.classList.contains('control-row--noted')).toBe(true);
  });

  // A row that shrank when its override was cleared moved the switch anyway,
  // whenever its pane was scrolled to the end: the scroller clamps and takes
  // the lost height back from the top. So a toggle that can be overridden is
  // laid out the same whether it is or not, and only the note's text changes.
  it('lays out an overridable toggle the same with and without its override', () => {
    const layout = (row: Element) => ({
      row: row.className,
      children: [...row.children].map((child) => child.className),
      value: [...row.querySelector('.control-row__value')!.children].map((child) =>
        child.getAttribute('role')
      ),
    });
    const view = render(<ToggleRow label="Aux" checked inherited onChange={() => {}} />);
    const row = view.querySelector('.control-row')!;
    const following = layout(row);
    expect(view.querySelector('.control-row__note')?.textContent).toBe('');

    rerender(
      <ToggleRow label="Aux" checked={false} inherited onChange={() => {}} onReset={() => {}} />
    );
    expect(layout(row)).toEqual(following);
    expect(view.querySelector('.control-row__note')?.textContent).toBe('Overridden');
    expect(following).toEqual({
      row: 'control-row control-row--noted',
      children: [
        'control-row__label',
        'control-row__value control-row__value--toggle',
        'control-row__note',
      ],
      value: ['switch'],
    });

    // A toggle that inherits nothing has no note to make room for.
    rerender(<ToggleRow label="Aux" checked onChange={() => {}} />);
    expect(view.querySelector('.control-row__note')).toBeNull();
    expect(row.classList.contains('control-row--noted')).toBe(false);
  });

  it('resets rather than pins when an override is switched back to the value it inherits', () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    const view = render(
      <ToggleRow label="Aux" checked inherited={false} onChange={onChange} onReset={onReset} />
    );
    const button = view.querySelector<HTMLButtonElement>('button[role="switch"]');
    act(() => button?.click());
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    // A pin that happens to agree with what it inherits: switching away from
    // it is an edit like any other.
    rerender(
      <ToggleRow label="Aux" checked={false} inherited={false} onChange={onChange} onReset={onReset} />
    );
    act(() => button?.click());
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onReset).toHaveBeenCalledTimes(1);

    // Nothing overridden, nothing to reset: the inherited value is just a value.
    rerender(<ToggleRow label="Aux" checked inherited={false} onChange={onChange} />);
    act(() => button?.click());
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onReset).toHaveBeenCalledTimes(1);
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

  it('keeps its trailing reset button, and no note, unlike a toggle', () => {
    const onReset = vi.fn();
    const view = render(
      <NumberRow label="Line width" value={2} onCommit={() => {}} onReset={onReset} />
    );
    const reset = view.querySelector<HTMLButtonElement>('.control-row__reset');
    expect(reset?.getAttribute('aria-label')).toBe('Reset Line width to default');
    expect(reset?.closest('.control-row__value')?.classList).toContain('control-row__value--reset');
    expect(view.querySelector('.control-row__note')).toBeNull();
    act(() => reset?.click());
    expect(onReset).toHaveBeenCalledTimes(1);
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
    const pressed = [...view.querySelectorAll<HTMLButtonElement>('[role="group"] button')].map(
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
    const buttons = view.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Align"] button');
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

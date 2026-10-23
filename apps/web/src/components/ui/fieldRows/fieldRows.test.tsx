import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollapsibleSection } from '../CollapsibleSection';
import { ColorField } from '../ColorField';
import { TooltipProvider } from '../Tooltip';
import { FieldRow, NumberRow, SegmentedRow, SelectRow, SliderRow, TextRow, ToggleRow } from './index';

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

/** A row's part, named by its data attribute rather than its module class. */
function part(element: Element): string {
  if (element.hasAttribute('data-field-label')) return 'label';
  if (element.hasAttribute('data-field-note')) return 'note';
  const kind = element.getAttribute('data-field-value');
  return kind === null ? element.tagName.toLowerCase() : `value:${kind}`;
}

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

/**
 * The row's own stylesheet on the page, for what only CSS decides. jsdom gets
 * no module class, so each class is read as the data attribute its element
 * carries (`.note` as `[data-field-note]`). Vitest's root is `apps/web`.
 */
function withFieldRowStyles(check: () => void) {
  const style = document.createElement('style');
  style.textContent = readFileSync(resolve(process.cwd(), 'src/components/ui/fieldRows/FieldRow.module.css'), 'utf8')
    .replace(/\.([a-z]+)\b/g, '[data-field-$1]');
  document.head.append(style);
  try {
    check();
  } finally {
    style.remove();
  }
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
    const row = view.querySelector('[data-field-row]');
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
    expect(view.querySelector('[data-field-note]')?.textContent).toBe('');
    expect(switchOf()?.hasAttribute('aria-describedby')).toBe(false);

    rerender(
      <ToggleRow label="Lighting" checked inherited={false} onChange={() => {}} onReset={() => {}} />
    );
    expect(view.querySelector('[data-field-reset]')).toBeNull();
    expect(view.querySelector('button[aria-label="Reset Lighting to default"]')).toBeNull();
    const note = view.querySelector('[data-field-note]');
    expect(note?.textContent).toBe('Overridden');
    // Read with the switch, not only seen beside it.
    expect(note?.id).toBeTruthy();
    expect(switchOf()?.getAttribute('aria-describedby')).toBe(note?.id);
  });

  it('keeps the switch where it was: the note takes a line of its own, never the value column', () => {
    const view = render(<ToggleRow label="Lighting" checked onChange={() => {}} />);
    const row = view.querySelector('[data-field-row]')!;
    const value = view.querySelector('[data-field-value]')!;
    const before = value.outerHTML.replace(value.innerHTML, '');
    expect(row.hasAttribute('data-noted')).toBe(false);

    rerender(<ToggleRow label="Lighting" checked onChange={() => {}} onReset={() => {}} />);
    // The same value box holding the switch alone, so the column is as wide
    // as it was; the note follows it in the row, which puts it on the grid's
    // second line under the label.
    expect(value.outerHTML.replace(value.innerHTML, '')).toBe(before);
    expect([...value.children].map((child) => child.getAttribute('role'))).toEqual(['switch']);
    expect([...row.children].map(part)).toEqual(['label', 'value:toggle', 'note']);
    expect(row.hasAttribute('data-noted')).toBe(true);
  });

  // A row that shrank when its override was cleared moved the switch anyway,
  // whenever its pane was scrolled to the end: the scroller clamps and takes
  // the lost height back from the top. So a toggle that can be overridden is
  // laid out the same whether it is or not, and only the note's text changes.
  it('lays out an overridable toggle the same with and without its override', () => {
    const layout = (row: Element) => ({
      noted: row.hasAttribute('data-noted'),
      children: [...row.children].map(part),
      value: [...row.querySelector('[data-field-value]')!.children].map((child) =>
        child.getAttribute('role')
      ),
    });
    const view = render(<ToggleRow label="Aux" checked inherited onChange={() => {}} />);
    const row = view.querySelector('[data-field-row]')!;
    const following = layout(row);
    expect(view.querySelector('[data-field-note]')?.textContent).toBe('');

    rerender(
      <ToggleRow label="Aux" checked={false} inherited onChange={() => {}} onReset={() => {}} />
    );
    expect(layout(row)).toEqual(following);
    expect(view.querySelector('[data-field-note]')?.textContent).toBe('Overridden');
    expect(following).toEqual({
      noted: true,
      children: ['label', 'value:toggle', 'note'],
      value: ['switch'],
    });

    // A toggle that inherits nothing has no note to make room for.
    rerender(<ToggleRow label="Aux" checked onChange={() => {}} />);
    expect(view.querySelector('[data-field-note]')).toBeNull();
    expect(row.hasAttribute('data-noted')).toBe(false);
  });

  it('dims a disabled row but not the reason it cannot be switched, which is what is left to read', () => {
    withFieldRowStyles(() => {
      const view = render(<ToggleRow label="Title block" checked={false} disabled note="Needs two rows or more" onChange={() => {}} />);
      const opacity = (selector: string) => getComputedStyle(view.querySelector(selector)!).opacity;
      const color = (selector: string) => getComputedStyle(view.querySelector(selector)!).color;
      expect(opacity('[data-field-label]')).toBe('0.5');
      expect(opacity('[data-field-note]')).not.toBe('0.5');
      // In the label's ink, not the quieter one "Overridden" wears.
      expect(color('[data-field-note]')).toBe(color('[data-field-label]'));
      // "Overridden" dims with its row, as it always has.
      rerender(<ToggleRow label="Grid" checked disabled inherited={false} onChange={() => {}} onReset={() => {}} />);
      expect(view.querySelector('[data-field-note]')?.textContent).toBe('Overridden');
      expect(opacity('[data-field-note]')).toBe('0.5');
    });
  });

  it('says why it cannot be switched on the note’s line, read with the switch', () => {
    const view = render(<ToggleRow label="Title block" checked={false} disabled note="Needs two rows or more" onChange={() => {}} />);
    const row = view.querySelector('[data-field-row]')!;
    const note = view.querySelector('[data-field-note]');
    expect(note?.textContent).toBe('Needs two rows or more');
    expect([...row.children].map(part)).toEqual(['label', 'value:toggle', 'note']);
    expect(view.querySelector('button[role="switch"]')?.getAttribute('aria-describedby')).toBe(note?.id);
    // Without one, the row has no note's line.
    rerender(<ToggleRow label="Title block" checked={false} onChange={() => {}} />);
    expect(view.querySelector('[data-field-note]')).toBeNull();
    expect(view.querySelector('button[role="switch"]')?.hasAttribute('aria-describedby')).toBe(false);
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
    const label = view.querySelector<HTMLLabelElement>('label[data-field-label]');
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
    const reset = view.querySelector<HTMLButtonElement>('[data-field-reset]');
    expect(reset?.getAttribute('aria-label')).toBe('Reset Line width to default');
    expect(reset?.closest('[data-field-value]')?.hasAttribute('data-reset')).toBe(true);
    expect(view.querySelector('[data-field-note]')).toBeNull();
    act(() => reset?.click());
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('explains itself behind a help mark, as the other rows do', () => {
    const view = render(
      <TooltipProvider>
        <NumberRow label="Steps on page 1" help="Its own count." value={9} onCommit={() => {}} />
      </TooltipProvider>
    );
    expect(view.querySelector('[data-field-help]')?.getAttribute('aria-label')).toBe('Its own count.');
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
  it('step in under the row they qualify, a select as the other rows do', () => {
    const view = render(
      <>
        <SelectRow label="Model" value="auto" options={[{ id: 'auto', label: 'Auto' }]} onChange={() => {}} />
        <SelectRow label="Crease pattern" nested value="auto" options={[{ id: 'auto', label: 'Auto' }]} onChange={() => {}} />
      </>
    );
    const nestedOf = (label: string) =>
      view.querySelector(`button[aria-label="${label}"]`)!.closest('[data-field-row]')!.hasAttribute('data-nested');
    expect(nestedOf('Model')).toBe(false);
    expect(nestedOf('Crease pattern')).toBe(true);
  });

  it('hold a list whose options carry a description to the row, the line clamped and the whole in its tooltip', () => {
    Element.prototype.scrollIntoView ??= () => {};
    const view = render(
      <SelectRow
        label="Symmetry axis"
        value="b"
        options={[
          { id: 'a', label: 'Diagonal', disabled: true, description: 'Stops at operation 1: a long reason that runs on and on.' },
          { id: 'b', label: 'Center line' },
        ]}
        onChange={() => {}}
      />
    );
    const row = view.querySelector('[data-field-row]')!;
    row.getBoundingClientRect = () => ({ width: 280 }) as DOMRect;
    const trigger = view.querySelector<HTMLButtonElement>('button[aria-label="Symmetry axis"]')!;
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(list.hasAttribute('data-capped')).toBe(true);
    expect(list.style.getPropertyValue('--select-max-width')).toBe('280px');
    const disabled = [...list.querySelectorAll('[role="option"]')].find((option) => option.textContent?.startsWith('Diagonal'))!;
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(disabled.querySelector('[title]')?.getAttribute('title')).toBe('Stops at operation 1: a long reason that runs on and on.');
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

  it('holds a drag itself and hands the value over once where it is let go', () => {
    const onCommit = vi.fn();
    const view = render(<SliderRow label="Nesting" min={0} max={1} step={0.05} value={0.8} onCommit={onCommit} />);
    const input = view.querySelector<HTMLInputElement>('input[type="range"]');
    if (!input) throw new Error('no slider');
    const readout = () => view.querySelector('[data-field-readout]')?.textContent;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const move = (value: string) =>
      act(() => {
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    // The thumb and the readout follow the drag; nothing is handed over.
    for (const value of ['0.7', '0.6', '0.55']) move(value);
    expect(readout()).toBe('0.55');
    expect(input.value).toBe('0.55');
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.55);
    // Let go, it shows its value again: the caller's, which here never took the commit.
    expect(readout()).toBe('0.80');
    // A drag that ends where it began hands nothing over.
    move('0.6');
    move('0.8');
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('shows the value with the step\'s decimals', () => {
    const view = render(
      <SliderRow label="Weight" min={0} max={2} step={0.1} value={0.7} onChange={() => {}} />
    );
    expect(view.querySelector('[data-field-readout]')?.textContent).toBe('0.7');
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

describe('FieldRow', () => {
  it('rules itself off by default, and goes without where asked', () => {
    const view = render(<ToggleRow label="Grid" checked={false} onChange={() => {}} />);
    expect(view.querySelector('[data-field-row]')?.hasAttribute('data-divider')).toBe(false);

    rerender(
      <FieldRow label="Last" kind="static" divider={false}>
        Value
      </FieldRow>
    );
    expect(view.querySelector('[data-field-row]')?.getAttribute('data-divider')).toBe('none');
  });

  it('is a button end to end for an action, holding nothing but text', () => {
    const onClick = vi.fn();
    const view = render(
      <FieldRow label="Action" kind="static" onClick={onClick}>
        Make Root
      </FieldRow>
    );
    const row = view.querySelector<HTMLButtonElement>('[data-field-row]');
    expect(row?.tagName).toBe('BUTTON');
    expect(row?.type).toBe('button');
    expect(row?.hasAttribute('data-action')).toBe(true);
    // Phrasing content only, as a button allows.
    expect([...(row?.children ?? [])].map((child) => child.tagName)).toEqual(['SPAN', 'SPAN']);
    expect(row?.textContent).toBe('ActionMake Root');
    act(() => row?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows a fact as plain text in the value column', () => {
    const view = render(
      <FieldRow label="Nodes" kind="static">
        4
      </FieldRow>
    );
    expect(view.querySelector('[data-field-value="static"]')?.textContent).toBe('4');
  });
});

describe('ColorField as a row', () => {
  it('is a FieldRow: its label points at the swatch, and the clear stays its own', () => {
    const onClear = vi.fn();
    const view = render(
      <ColorField label="Front" layout="row" value="#ff0000" divider={false} onChange={() => {}} onClear={onClear} />
    );
    const row = view.querySelector('[data-field-row]');
    const label = view.querySelector<HTMLLabelElement>('label[data-field-label]');
    const swatch = view.querySelector<HTMLInputElement>('input[type="color"]');
    expect(row?.getAttribute('data-divider')).toBe('none');
    expect(label?.textContent).toBe('Front');
    expect(label?.htmlFor).toBe(swatch?.id);
    expect(swatch?.closest('[data-field-value]')?.getAttribute('data-field-value')).toBe('color');
    // Not the row's reset: the field's own clear, as in its other layouts.
    expect(view.querySelector('[data-field-reset]')).toBeNull();
    act(() => view.querySelector<HTMLButtonElement>('button[aria-label="Reset Front to default"]')?.click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('keeps its other layouts out of the row', () => {
    const view = render(<ColorField label="Background" layout="inline" value="#ffffff" onChange={() => {}} />);
    expect(view.querySelector('[data-field-row]')).toBeNull();
    expect(view.querySelector('label')?.textContent).toBe('Background');
  });
});

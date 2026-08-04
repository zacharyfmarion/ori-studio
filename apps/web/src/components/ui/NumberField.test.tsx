import { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField';

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

/** Stands in for the caller that owns the value, so a commit moves the prop. */
function Harness({
  initial,
  onCommit,
  ...props
}: {
  initial: number;
  onCommit?: (value: number) => void;
} & Partial<Parameters<typeof NumberField>[0]>) {
  const [value, setValue] = useState(initial);
  return (
    <NumberField
      label="Line width"
      min={1}
      max={8}
      normalize={(next) => Math.min(8, Math.max(1, Math.round(next)))}
      {...props}
      value={value}
      onCommit={(next) => {
        setValue(next);
        onCommit?.(next);
      }}
    />
  );
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

function field(view: HTMLElement) {
  const input = view.querySelector<HTMLInputElement>('input');
  const down = view.querySelector<HTMLButtonElement>('button[data-direction="down"]');
  const up = view.querySelector<HTMLButtonElement>('button[data-direction="up"]');
  if (!input) throw new Error('NumberField did not render an input');
  return { input, down, up };
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  act(() => {
    input.focus();
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('NumberField', () => {
  it('commits on the step click rather than waiting for blur', () => {
    const onCommit = vi.fn();
    const view = render(<Harness initial={2} onCommit={onCommit} />);
    const { input, up, down } = field(view);

    act(() => up?.click());
    expect(onCommit).toHaveBeenLastCalledWith(3);
    expect(input.value).toBe('3');
    // Still focused elsewhere — the value moved without an Enter or a blur.
    expect(document.activeElement).not.toBe(input);

    act(() => down?.click());
    expect(onCommit).toHaveBeenLastCalledWith(2);
    expect(input.value).toBe('2');
  });

  it('steps from a typed but uncommitted draft', () => {
    const onCommit = vi.fn();
    const view = render(<Harness initial={2} onCommit={onCommit} />);
    const { input, up } = field(view);

    type(input, '5');
    expect(onCommit).not.toHaveBeenCalled();

    act(() => up?.click());
    expect(onCommit).toHaveBeenLastCalledWith(6);
  });

  it('disables a step button when the bound would clamp it back', () => {
    const view = render(<Harness initial={1} />);
    const { input, up, down } = field(view);

    expect(down?.disabled).toBe(true);
    expect(up?.disabled).toBe(false);

    type(input, '8');
    expect(up?.disabled).toBe(true);
    expect(down?.disabled).toBe(false);
  });

  it('steps and commits on Arrow Up/Down', () => {
    const onCommit = vi.fn();
    const view = render(<Harness initial={4} onCommit={onCommit} />);
    const { input } = field(view);

    press(input, 'ArrowUp');
    expect(onCommit).toHaveBeenLastCalledWith(5);
    expect(input.value).toBe('5');

    press(input, 'ArrowDown');
    expect(onCommit).toHaveBeenLastCalledWith(4);
  });

  it('keeps fractional steps free of float noise', () => {
    const view = render(
      <Harness initial={1} step={0.1} min={undefined} max={undefined} normalize={undefined} />
    );
    const { input, up } = field(view);

    act(() => up?.click());
    act(() => up?.click());
    act(() => up?.click());
    expect(input.value).toBe('1.3');
  });

  it('clamps a typed value on blur and reverts an unparseable one', () => {
    const onCommit = vi.fn();
    const view = render(<Harness initial={2} onCommit={onCommit} />);
    const { input } = field(view);

    type(input, '99');
    act(() => input.blur());
    expect(onCommit).toHaveBeenLastCalledWith(8);

    type(input, '');
    act(() => input.blur());
    expect(input.value).toBe('8');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('reverts the draft on Escape without committing', () => {
    const onCommit = vi.fn();
    const view = render(<Harness initial={3} onCommit={onCommit} />);
    const { input } = field(view);

    type(input, '7');
    press(input, 'Escape');
    expect(input.value).toBe('3');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('renders a bare input when the caller has no room for steppers', () => {
    const view = render(<Harness initial={2} steppers={false} />);
    expect(view.querySelectorAll('button')).toHaveLength(0);
    expect(view.querySelector('.number-field')).toBeNull();

    // The native spinners are still off, which is what the class carries.
    expect(field(view).input.classList.contains('number-field__input')).toBe(true);
  });

  it('shows a unit between the value and the increase button', () => {
    const view = render(<Harness initial={90} min={1} max={179} suffix="°" />);
    expect(view.querySelector('.number-field__suffix')?.textContent).toBe('°');
  });
});

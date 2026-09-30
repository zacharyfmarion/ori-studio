import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SegmentedControl,
  type SegmentedControlSize,
  type SegmentedOption,
} from './SegmentedControl';
import { TooltipProvider } from './Tooltip';
import { TOUCH_LABEL_HOLD_MS } from './useTouchLabel';

/**
 * What a screen can ask of the control, and what it cannot get wrong: the
 * track takes its size and stretch from props (the only way to vary it — see
 * `docs/styling.md`), a `null` value is the mixed state and presses nothing,
 * and a disabled control stays readable but refuses a choice.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const OPTIONS = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back', title: 'The side facing away' },
] as const;

function mount({
  value = 'front',
  onChange = () => {},
  disabled,
  size,
  fill,
}: {
  value?: 'front' | 'back' | null;
  onChange?: (value: 'front' | 'back') => void;
  disabled?: boolean;
  size?: SegmentedControlSize;
  fill?: boolean;
}) {
  act(() =>
    root.render(
      <SegmentedControl
        aria-label="Side"
        options={[...OPTIONS]}
        value={value}
        onChange={onChange}
        disabled={disabled}
        size={size}
        fill={fill}
      />
    )
  );
}

const group = () => container.querySelector<HTMLElement>('[role="group"]');
const option = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === label
  );
const pressed = () =>
  [...container.querySelectorAll('button')].map((button) => button.getAttribute('aria-pressed'));

describe('SegmentedControl', () => {
  it('is a labelled group that presses the chosen option alone', () => {
    mount({ value: 'back' });
    expect(group()?.getAttribute('aria-label')).toBe('Side');
    expect(pressed()).toEqual(['false', 'true']);
    expect(option('Back')?.hasAttribute('data-active')).toBe(true);
    expect(option('Front')?.hasAttribute('data-active')).toBe(false);
  });

  it('presses nothing for a mixed value', () => {
    mount({ value: null });
    expect(pressed()).toEqual(['false', 'false']);
  });

  it('reports the option chosen', () => {
    const onChange = vi.fn();
    mount({ onChange });
    act(() => option('Back')?.click());
    expect(onChange).toHaveBeenCalledWith('back');
  });

  it('stays readable but refuses a choice when disabled', () => {
    const onChange = vi.fn();
    mount({ onChange, disabled: true });
    expect(option('Back')?.disabled).toBe(true);
    act(() => option('Back')?.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(pressed()).toEqual(['true', 'false']);
  });

  it('names each option, preferring its own title', () => {
    mount({});
    expect(option('Front')?.title).toBe('Front');
    expect(option('Back')?.title).toBe('The side facing away');
  });

  it('hugs at the middle size unless asked otherwise', () => {
    mount({});
    expect(group()?.dataset.size).toBe('md');
    expect(group()?.hasAttribute('data-fill')).toBe(false);

    mount({ size: 'sm', fill: true });
    expect(group()?.dataset.size).toBe('sm');
    expect(group()?.hasAttribute('data-fill')).toBe(true);
  });
});

/**
 * What the line types needed to move onto the control: letters for icons, the
 * app tooltip a finger can summon, and one option refusing on its own.
 */
describe('SegmentedControl option extras', () => {
  type Side = 'front' | 'back';
  const withExtras = (extras: Partial<SegmentedOption<Side>>, onChange = vi.fn()) => {
    act(() =>
      root.render(
        <TooltipProvider delayDuration={0}>
          <SegmentedControl<Side>
            aria-label="Side"
            iconsOnly
            value="front"
            onChange={onChange}
            options={[
              { value: 'front', label: 'Front', icon: <b>F</b> },
              { value: 'back', label: 'Back', icon: <b>B</b>, ...extras },
            ]}
          />
        </TooltipProvider>
      )
    );
    return onChange;
  };
  const byName = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

  it('draws only the icon, naming the option by its label', () => {
    withExtras({});
    expect(byName('Back')?.textContent).toBe('B');
  });

  it('shows a tooltip instead of the native title', () => {
    withExtras({ tooltip: 'The side facing away' });
    expect(byName('Back')?.hasAttribute('title')).toBe(false);
    expect(byName('Front')?.title).toBe('Front');
  });

  it('names an option on a press-and-hold without choosing it', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('pointer: coarse'),
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    const onChange = withExtras({ tooltip: 'The side facing away' });
    const back = byName('Back');
    const touch = (type: string) =>
      new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: 0, clientY: 0 });

    act(() => {
      back?.dispatchEvent(touch('pointerdown'));
    });
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
    });
    expect(document.querySelector('.tooltip-content')?.textContent).toContain(
      'The side facing away'
    );

    act(() => {
      back?.dispatchEvent(touch('pointerup'));
      back?.click();
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => back?.click());
    expect(onChange).toHaveBeenCalledWith('back');
  });

  it('lets one option refuse, still focusable so its tooltip can say why', () => {
    const onChange = withExtras({ disabled: true, tooltip: 'Not on this sheet' });
    const back = byName('Back');
    expect(back?.getAttribute('aria-disabled')).toBe('true');
    expect(back?.disabled).toBe(false);
    act(() => back?.click());
    expect(onChange).not.toHaveBeenCalled();
    act(() => byName('Front')?.click());
    expect(onChange).toHaveBeenCalledWith('front');
  });
});

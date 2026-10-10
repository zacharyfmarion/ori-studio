import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptionCards } from './OptionCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const OPTIONS = [
  { value: 'grid', label: 'Grid', description: 'Rows read left to right.' },
  { value: 'flow', label: 'Flow', description: 'Rows turn back at each end.' },
  { value: 'pile', label: 'Pile', disabled: true, title: 'Not here' },
] as const;

function render(value: string, onChange = vi.fn(), disabled = false) {
  act(() =>
    root.render(
      <OptionCards label="Layout" value={value} options={[...OPTIONS]} onChange={onChange} disabled={disabled} />
    )
  );
  return onChange;
}

const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const key = (target: HTMLElement, name: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });

describe('OptionCards', () => {
  it('is a radio group with one tab stop, on the chosen card', () => {
    render('flow');
    expect(host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Layout');
    expect(radios().map((radio) => [radio.getAttribute('aria-checked'), radio.tabIndex])).toEqual([
      ['false', -1],
      ['true', 0],
      ['false', -1],
    ]);
    expect(radios()[0]!.textContent).toBe('GridRows read left to right.');
  });

  it('chooses with a press, and with the arrows, skipping nothing but refusing a disabled card', () => {
    const onChange = render('grid');
    act(() => radios()[1]!.click());
    expect(onChange).toHaveBeenLastCalledWith('flow');
    key(radios()[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(radios()[1]);
    expect(onChange).toHaveBeenLastCalledWith('flow');
    onChange.mockClear();
    key(radios()[1]!, 'End');
    // Focus reaches the disabled card, where its title says why, but it is not chosen.
    expect(document.activeElement).toBe(radios()[2]);
    expect(onChange).not.toHaveBeenCalled();
    act(() => radios()[2]!.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses every choice while the group is disabled', () => {
    const onChange = render('grid', vi.fn(), true);
    act(() => radios()[1]!.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(radios()[1]!.getAttribute('aria-disabled')).toBe('true');
  });
});

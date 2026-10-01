import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectionHintSelectionSummary } from './directionHintActions';
import { DirectionHintControl } from './DirectionHintControl';

/**
 * The control's half of the fold-direction verb — the descriptors and the
 * summary are tested beside them, and the store binding is stubbed here: one
 * answer among three, pressed only when the whole selection agrees.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const binding = vi.hoisted(() => ({
  summary: {
    hint: null,
    unassignedCount: 0,
    otherCount: 0,
    mixed: false,
  } as DirectionHintSelectionSummary,
  enabled: true,
  setHint: vi.fn(),
}));

vi.mock('./useDirectionHintSelection', () => ({
  useDirectionHintSelection: () => binding,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  binding.setHint.mockReset();
  binding.enabled = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(summary: Partial<DirectionHintSelectionSummary>) {
  binding.summary = { hint: null, unassignedCount: 2, otherCount: 0, mixed: false, ...summary };
  act(() => root.render(<DirectionHintControl />));
}

const pressed = () =>
  [...container.querySelectorAll('[role="group"] button')].map((button) => [
    button.textContent,
    button.getAttribute('aria-pressed'),
  ]);

describe('DirectionHintControl', () => {
  it('presses the hint the whole selection shares', () => {
    render({ hint: 'Valley' });
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Fold direction'
    );
    expect(pressed()).toEqual([
      ['Mountain', 'false'],
      ['Valley', 'true'],
      ['None', 'false'],
    ]);
  });

  it('presses None when every crease is unhinted', () => {
    render({ hint: null });
    expect(pressed().find(([label]) => label === 'None')?.[1]).toBe('true');
  });

  // A mixed selection and an unhinted one both carry `hint: null`; only `mixed`
  // keeps None from reading as the answer for creases that disagree.
  it('presses nothing on a mixed selection', () => {
    render({ hint: null, mixed: true });
    expect(pressed().every(([, state]) => state === 'false')).toBe(true);
  });

  it('sets the hint chosen', () => {
    render({ hint: null });
    const mountain = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Mountain'
    );
    act(() => mountain?.click());
    expect(binding.setHint).toHaveBeenCalledWith('Mountain');
  });

  it('renders nothing when no selected crease can take a hint', () => {
    binding.enabled = false;
    act(() => root.render(<DirectionHintControl />));
    expect(container.innerHTML).toBe('');
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferencesApproximationWarningDialog } from './ReferencesApproximationWarningDialog';
import type { ReferencesApproximationWarning } from './useReferencesApproximationWarning';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(props: Partial<ReferencesApproximationWarning> = {}) {
  const dismiss = vi.fn();
  const all: ReferencesApproximationWarning = {
    open: true,
    reason: 'inexact',
    inexactSteps: 22,
    exactnessClass: 'off_lattice',
    dismiss,
    ...props,
  };
  act(() => root?.render(<ReferencesApproximationWarningDialog {...all} />));
  return dismiss;
}

const dialog = () => container?.querySelector('[role="alertdialog"]') ?? null;

describe('ReferencesApproximationWarningDialog', () => {
  it('renders nothing while closed', () => {
    render({ open: false });
    expect(dialog()).toBeNull();
  });

  it('shows the warning as a modal with the verification message', () => {
    render();
    const node = dialog();
    expect(node).not.toBeNull();
    expect(node?.getAttribute('aria-modal')).toBe('true');
    expect(node?.textContent).toContain('Approximated folds');
    expect(node?.textContent).toContain('This sequence contains approximated folds.');
    expect(node?.textContent).toContain('verify that any reference points are correct');
  });

  it('says planning failed when the plan stopped rather than approximate', () => {
    render({ reason: 'too_many', inexactSteps: 0 });
    const node = dialog();
    expect(node?.textContent).toContain('Planning failed');
    expect(node?.textContent).toContain(
      'Planning failed because a huge number of reference creases would be necessary to fold this pattern within error tolerances.'
    );
    expect(node?.textContent).toContain('Detect CP from Image');
    expect(node?.textContent).toContain('verify that any reference points are correct');
    expect(node?.textContent).not.toContain('This sequence contains approximated folds.');
  });

  it('dismisses from the action, the close button, the backdrop and Escape', () => {
    let dismiss = render();
    const button = [...(container?.querySelectorAll('button') ?? [])].find(
      (element) => element.textContent === 'Got it'
    );
    act(() => button?.click());
    expect(dismiss).toHaveBeenCalledTimes(1);

    dismiss = render();
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Close the approximated folds warning"]')
        ?.click();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);

    dismiss = render();
    act(() => {
      dialog()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
    // A press inside the document must not count as one on the backdrop.
    act(() => {
      dialog()
        ?.querySelector('[role="document"]')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(dismiss).toHaveBeenCalledTimes(1);

    dismiss = render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

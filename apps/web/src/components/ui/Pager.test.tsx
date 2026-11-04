import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldRow } from './fieldRows';
import { Pager } from './Pager';
import { TooltipProvider } from './Tooltip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const button = (name: string) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

function render(node: ReactNode) {
  act(() => root?.render(<TooltipProvider>{node}</TooltipProvider>));
}

describe('Pager', () => {
  it('names its verbs, shows where it stands, and runs a verb on a press', () => {
    const next = vi.fn();
    render(
      <Pager
        label="Layer order"
        previous={{ label: 'Previous', disabled: false, run: vi.fn() }}
        next={{ label: 'Next', disabled: false, run: next }}
      >
        2 of 5+
      </Pager>
    );
    expect(host?.textContent).toBe('2 of 5+');
    // A group named by what it steps, whose readout is announced whole as it changes.
    const pager = host?.querySelector('[role="group"][aria-label="Layer order"]');
    const readout = pager?.querySelector('[aria-live="polite"]');
    expect(readout?.textContent).toBe('2 of 5+');
    expect(readout?.getAttribute('aria-atomic')).toBe('true');
    expect(button('Previous')?.getAttribute('aria-disabled')).toBeNull();
    act(() => button('Next')?.click());
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('refuses a verb without taking it out of the tab order, and says why', () => {
    const previous = vi.fn();
    render(
      <Pager label="Layer order" previous={{ label: 'Previous', disabled: true, hint: 'This is its first', run: previous }}>
        1 of 5
      </Pager>
    );
    const back = button('Previous');
    expect(back?.getAttribute('aria-disabled')).toBe('true');
    expect(back?.disabled).toBe(false);
    // Refusing is the verb's own: the press still reaches it.
    act(() => back?.click());
    expect(previous).toHaveBeenCalledTimes(1);
    // No next: its place is empty.
    expect(host?.querySelectorAll('button')).toHaveLength(1);
  });

  it('is named by its row’s label, so the name is said once', () => {
    render(
      <FieldRow label="Layer order" labelId="layer-order-label" kind="text">
        <Pager labelledBy="layer-order-label">2 of 5+</Pager>
      </FieldRow>
    );
    const pager = host?.querySelector('[role="group"]');
    expect(pager?.getAttribute('aria-labelledby')).toBe('layer-order-label');
    expect(pager?.hasAttribute('aria-label')).toBe(false);
    expect(host?.querySelector('#layer-order-label')?.textContent).toBe('Layer order');
  });
});

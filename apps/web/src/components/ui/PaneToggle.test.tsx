import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PanePill, PaneToggle, type PaneToggleOption } from './PaneToggle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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

const panes: PaneToggleOption<'folded' | 'pattern'>[] = [
  { id: 'folded', title: 'Folded' },
  { id: 'pattern', title: 'Crease pattern' },
];

const buttons = () => [...(container?.querySelectorAll('button') ?? [])];

describe('PaneToggle', () => {
  it('is one pill, named for the pane not on screen, that shows it', () => {
    const shown: string[] = [];
    act(() =>
      root?.render(<PaneToggle options={panes} active="folded" onShow={(id) => shown.push(id)} />)
    );

    expect(buttons().map((button) => button.textContent)).toEqual(['Crease pattern']);
    act(() => buttons()[0].click());
    expect(shown).toEqual(['pattern']);

    act(() =>
      root?.render(<PaneToggle options={panes} active="pattern" onShow={(id) => shown.push(id)} />)
    );
    expect(buttons().map((button) => button.textContent)).toEqual(['Folded']);
  });

  // The look is the canvas lane's, shared with every pill it holds.
  it('wears the lane’s pill', () => {
    act(() => root?.render(<PaneToggle options={panes} active="folded" onShow={() => {}} />));

    expect(buttons()[0].classList.contains('canvas-pill')).toBe(true);
  });

  it('draws nothing with nothing to switch to', () => {
    act(() => root?.render(<PaneToggle options={[]} active="folded" onShow={() => {}} />));

    expect(buttons()).toHaveLength(0);
  });
});

describe('PanePill', () => {
  // A list's trigger: the same pill, holding a ref for focus to come back to.
  it('passes its ref and attributes to the button', () => {
    const ref = createRef<HTMLButtonElement>();
    act(() =>
      root?.render(
        <PanePill ref={ref} aria-haspopup="dialog">
          Panes
        </PanePill>
      )
    );

    expect(ref.current).toBe(buttons()[0]);
    expect(ref.current?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(ref.current?.classList.contains('canvas-pill')).toBe(true);
  });
});

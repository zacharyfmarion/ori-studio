import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpRiver, OristudioBpTreeEdge } from '../../engine/oristudioBpTypes';
import { TooltipProvider } from '../ui/Tooltip';
import { BpRiverEditor } from './BpRiverEditor';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = window.document.createElement('div');
  window.document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const river: OristudioBpRiver = { id: 3, edgeId: 7, vertices: [1, 2], width: 2 };

function edge(overrides: Partial<OristudioBpTreeEdge> = {}): OristudioBpTreeEdge {
  return {
    id: 7,
    vertices: [1, 2],
    length: 2,
    maxLength: 5,
    isLeafEdge: false,
    dualRiverId: 3,
    ...overrides,
  };
}

function renderEditor(dual = edge()) {
  const onSetWidth = vi.fn();
  const onEscape = vi.fn();
  act(() => {
    root.render(
      <TooltipProvider>
        <BpRiverEditor river={river} edge={dual} onSetWidth={onSetWidth} onEscape={onEscape} />
      </TooltipProvider>,
    );
  });
  return { onSetWidth, onEscape };
}

const input = () => container.querySelector('input') as HTMLInputElement;
const buttons = () => [...container.querySelectorAll('button')];
const increase = () => buttons()[1];
const decrease = () => buttons()[0];

function setValue(field: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Enter, not blur: React listens on focusout, which a dispatched blur event
// does not produce in jsdom.
function commit(field: HTMLInputElement) {
  act(() => field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
}

describe('BpRiverEditor', () => {
  it('shows the rivers current width', () => {
    renderEditor();
    expect(input().value).toBe('2');
  });

  it('steps the width up and down by one grid unit', () => {
    const { onSetWidth } = renderEditor();
    act(() => increase().click());
    expect(onSetWidth).toHaveBeenLastCalledWith(3);
    act(() => decrease().click());
    expect(onSetWidth).toHaveBeenLastCalledWith(1);
  });

  it('will not step below one, which is upstreams floor', () => {
    const { onSetWidth } = renderEditor(edge({ length: 1 }));
    expect(decrease().disabled).toBe(true);
    act(() => decrease().click());
    expect(onSetWidth).not.toHaveBeenCalled();
  });

  it('will not step past the edges ceiling', () => {
    const { onSetWidth } = renderEditor(edge({ length: 5, maxLength: 5 }));
    expect(increase().disabled).toBe(true);
    act(() => increase().click());
    expect(onSetWidth).not.toHaveBeenCalled();
  });

  it('commits a typed width on Enter, clamped to the edges ceiling', () => {
    const { onSetWidth } = renderEditor();
    setValue(input(), '99');
    commit(input());
    expect(onSetWidth).toHaveBeenCalledWith(5);
  });

  it('reverts a typed width on Escape and releases the pane', () => {
    const { onSetWidth, onEscape } = renderEditor();
    setValue(input(), '4');
    act(() =>
      input().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })),
    );
    expect(onSetWidth).not.toHaveBeenCalled();
    expect(input().value).toBe('2');
    expect(onEscape).toHaveBeenCalled();
  });

  it('never steals focus on mount', () => {
    renderEditor();
    expect(window.document.activeElement).not.toBe(input());
  });

  /**
   * The ceiling is a guard, not a design constraint — box-pleat's is
   * `ceil(8192·√2)` less the depth the branch already spends, which reads as a
   * meaningless five-digit number. Upstream never renders it either.
   */
  it('applies the ceiling without showing it', () => {
    renderEditor();
    expect(input().getAttribute('max')).toBe('5');
    expect(container.textContent).not.toContain('5');
  });
});

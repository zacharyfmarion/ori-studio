import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_STYLE, type Pen } from '../../lib/paper/paperStyle';
import { PaperPenCard, samplePenDash, samplePenWidth } from './PaperPenCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(pen: Pen, ground = '#ffff32'): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <PaperPenCard
        label="Edges"
        pen={pen}
        ground={ground}
        disabled={false}
        onAdjust={vi.fn()}
        onSet={vi.fn()}
        onCommit={vi.fn()}
      />
    )
  );
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('sample geometry', () => {
  it('draws a pen at the width every surface draws it at, dash multiples and all', () => {
    // pt × 4/3, the one conversion `ptToDevicePx` makes at a screen's own scale.
    expect(samplePenWidth({ ...DEFAULT_PAPER_STYLE.edges, width: 0.9 })).toBe(1.2);
    expect(samplePenWidth({ ...DEFAULT_PAPER_STYLE.edges, width: 3 })).toBe(4);
    expect(samplePenDash({ ...DEFAULT_PAPER_STYLE.edges, width: 0.9, dash: null })).toBeUndefined();
    expect(samplePenDash({ ...DEFAULT_PAPER_STYLE.edges, width: 0.9, dash: [4, 2] })).toBe(
      '4.8 2.4'
    );
  });
});

describe('PaperPenCard', () => {
  it('names the pen once, and every control after it', () => {
    const rendered = render(DEFAULT_PAPER_STYLE.edges);
    expect(rendered.querySelector('.control-row__label')?.textContent).toBe('Edges');
    expect(
      Array.from(rendered.querySelectorAll('[aria-label]')).map((element) =>
        element.getAttribute('aria-label')
      )
    ).toEqual([
      'Edges color',
      'Decrease Edges width',
      'Edges width',
      'Increase Edges width',
      'Edges cap',
      'Edges dash',
    ]);
  });

  it('sits the sample on the paper the pen draws on, not on a field of its own', () => {
    const rendered = render(DEFAULT_PAPER_STYLE.edges, '#112233');
    const sample = rendered.querySelector<SVGElement>('.settings-paper-pen__sample')!;
    expect(sample.style.getPropertyValue('--settings-paper-sample-ground')).toBe('#112233');
    // Decoration: the card's words already name the pen this draws.
    expect(sample.getAttribute('aria-hidden')).toBe('true');
  });
});

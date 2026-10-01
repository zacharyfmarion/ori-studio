import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_STYLE, type Pen } from '../../lib/paper/paperStyle';
import { PaperPenCard, samplePenDash, samplePenWidth } from './PaperPenCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(pen: Pen, paper = DEFAULT_PAPER_STYLE.paper): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <PaperPenCard
        label="Edges"
        pen={pen}
        paper={paper}
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

  it('sits the sample on both sides of the paper the pen draws on, not on a field', () => {
    const rendered = render(DEFAULT_PAPER_STYLE.edges, { front: '#112233', back: '#445566' });
    const sample = rendered.querySelector<SVGElement>('.settings-paper-pen__sample')!;
    const side = (name: string) => sample.querySelector(`rect[data-side="${name}"]`)!;
    expect(side('front').getAttribute('fill')).toBe('#112233');
    expect(side('back').getAttribute('fill')).toBe('#445566');
    // The paper is the SVG's own, not a CSS ground behind it.
    expect(sample.getAttribute('style')).toBeNull();
    // Decoration: the card's words already name the pen this draws.
    expect(sample.getAttribute('aria-hidden')).toBe('true');
  });

  it('puts the front on the left, the back on the right, and one line across both', () => {
    const sample = render(DEFAULT_PAPER_STYLE.edges).querySelector<SVGElement>(
      '.settings-paper-pen__sample'
    )!;
    // Paint order: the back under the whole strip, the front over its left
    // half, the pen over both — so the right half is the back.
    expect(
      Array.from(sample.children).map(
        (child) => child.getAttribute('data-side') ?? child.tagName.toLowerCase()
      )
    ).toEqual(['back', 'front', 'line']);
    const [back, front, line] = Array.from(sample.children);
    expect([back.getAttribute('x'), back.getAttribute('width')]).toEqual([null, '100%']);
    expect([front.getAttribute('x'), front.getAttribute('width')]).toEqual([null, '50%']);
    // Wherever the strip's width lands, the line starts on the front and ends
    // on the back: 11 px in, 95% across.
    for (const width of [120, 480]) {
      expect(stripPx(line.getAttribute('x1')!, width)).toBeLessThan(width / 2);
      expect(stripPx(line.getAttribute('x2')!, width)).toBeGreaterThan(width / 2);
    }
  });
});

/** An SVG length on the strip, in px, at a strip `width` px wide. */
function stripPx(length: string, width: number): number {
  const value = Number.parseFloat(length);
  return length.endsWith('%') ? (value / 100) * width : value;
}

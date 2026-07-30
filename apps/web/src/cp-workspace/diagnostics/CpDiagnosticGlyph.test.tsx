import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import { CpDiagnosticGlyph } from './CpDiagnosticGlyph';
import { cpDiagnosticMarkerStyle } from './geometry';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function entry(over: Partial<OristudioCpDiagnosticEntry> = {}): OristudioCpDiagnosticEntry {
  return { id: 'CheckCamv-1', kind: 'CheckCamv', severity: 'error', message: 'x', ...over };
}

describe('CpDiagnosticGlyph', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (e: OristudioCpDiagnosticEntry) => {
    act(() => root.render(<CpDiagnosticGlyph t={t} entry={e} />));
    return host.querySelector('svg') as SVGElement;
  };

  it('draws the shape the canvas draws, for every rule', () => {
    // Not a restatement of cpDiagnosticMarkerStyle — the point is that the glyph
    // *defers* to it. If this component ever grows its own classification, these
    // two disagree and the list stops matching the canvas.
    for (const rule of ['NumberOfFolds', 'Maekawa', 'Angles', 'LittleBigLittle'] as const) {
      for (const color of ['NotEnoughMountain', 'NotEnoughValley', 'Equal', 'Correct', 'Unknown']) {
        const e = entry({ rule, violation_color: color });
        const svg = render(e);
        const style = cpDiagnosticMarkerStyle(e);
        expect(svg.dataset.shape, `${rule} + ${color}`).toBe(style.shape);
        expect(svg.dataset.tone, `${rule} + ${color}`).toBe(style.tone);
      }
    }
  });

  it('tones a mountain shortfall red and a valley shortfall blue', () => {
    expect(
      render(entry({ rule: 'Maekawa', violation_color: 'NotEnoughMountain' })).dataset.tone
    ).toBe('mountain');
    expect(render(entry({ rule: 'Maekawa', violation_color: 'NotEnoughValley' })).dataset.tone).toBe(
      'valley'
    );
  });

  it('draws Kawasaki-only failures as a hollow ring', () => {
    // Oriedita's empty circle: the fold types are right, only the angles are
    // wrong. The stylesheet removes the fill; the shape name is what selects it.
    const svg = render(entry({ rule: 'Angles', violation_color: 'Correct' }));
    expect(svg.dataset.shape).toBe('ring');
    expect(svg.querySelector('circle')).not.toBeNull();
  });

  it('carries the shape legend as its accessible name', () => {
    // The row text deliberately does not repeat the shape's heading for squares,
    // so hover/AT is where that half of Oriedita's legend stays reachable.
    const svg = render(entry({ rule: 'Maekawa', violation_color: 'Equal' }));
    expect(svg.getAttribute('aria-label')).toBe('Incorrect fold types');
    expect(svg.querySelector('title')?.textContent).toBe('Incorrect fold types');
    expect(svg.getAttribute('role')).toBe('img');
  });

  it('stays decorative when the shape has no legend entry', () => {
    // A generic cross says nothing a screen reader needs; the message beside it
    // already carries the content.
    const svg = render(entry({ kind: 'Check1', rule: 'Check1', message: 'Overlapping creases' }));
    expect(svg.dataset.shape).toBe('generic');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('title')).toBeNull();
  });

  it('gives self-intersection its own shape and the danger tone', () => {
    // Distinct from a closure failure: those say the angles disagree, this says
    // they agree and the result still is not reachable. Same row, different
    // problem, so the glyph must not be the closure one.
    const svg = render(entry({ kind: 'SpatialSelfIntersection', rule: 'SelfIntersection' }));
    expect(svg.dataset.shape).toBe('self-intersection');
    expect(svg.dataset.tone).toBe('danger');
    expect(svg.getAttribute('aria-label')).toMatch(/crossing itself/u);
  });

  it('keeps the column when there is nothing to draw', () => {
    // `None` classifies the vertex but draws no marker. The svg still occupies
    // the grid cell so rows do not jog left.
    const svg = render(entry({ rule: 'None', violation_color: 'Correct' }));
    expect(svg.dataset.shape).toBe('none');
    expect(svg.childElementCount).toBe(0);
  });
});

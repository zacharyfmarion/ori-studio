import { afterEach, describe, expect, it } from 'vitest';
import { diagramInkColors } from './diagramColors';

const hex = ([r, g, b]: readonly number[]): string =>
  `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;

const mounted: Element[] = [];

/** An element carrying the workspace's tokens, inside a document whose `:root` carries others. */
function scoped(tokens: Record<string, string>): Element {
  document.documentElement.style.setProperty('--fold-mountain', '#ff0000');
  document.documentElement.style.setProperty('--fold-valley', '#0000ff');
  document.documentElement.style.setProperty('--fold-border', '#000000');
  document.documentElement.style.setProperty('--fold-unassigned', '#999999');
  document.documentElement.style.setProperty('--cp-reference-input', '#ff00ff');
  document.documentElement.style.setProperty('--references-crease-alpha', '0.5');
  const element = document.createElement('div');
  for (const [name, value] of Object.entries(tokens)) element.style.setProperty(name, value);
  document.body.append(element);
  mounted.push(element);
  return element;
}

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
  for (const name of [
    '--fold-mountain',
    '--fold-valley',
    '--fold-border',
    '--fold-unassigned',
    '--cp-reference-input',
    '--references-crease-alpha',
  ]) {
    document.documentElement.style.removeProperty(name);
  }
});

describe('diagramInkColors', () => {
  it('reads the tokens off the element it is given, not the document', () => {
    const element = scoped({ '--fold-mountain': '#112233', '--fold-valley': '#445566' });
    const colors = diagramInkColors(element);
    expect(hex(colors.mountain)).toBe('#112233');
    expect(hex(colors['pinch-mountain'])).toBe('#112233');
    expect(hex(colors.valley)).toBe('#445566');
    // What the element does not set, it inherits — the theme's own tokens.
    expect(hex(colors.edge)).toBe('#000000');
    expect(hex(colors.highlight)).toBe('#ff00ff');
    expect(hex(diagramInkColors(document.documentElement).mountain)).toBe('#ff0000');
  });

  it('takes the values it is handed over the DOM, and the DOM over one it cannot parse', () => {
    // The render that sets a token on the element is the render that packs the
    // lines, so the new values arrive as values before the DOM has them.
    const element = scoped({ '--fold-mountain': '#112233' });
    const colors = diagramInkColors(element, {
      '--fold-mountain': '#778899',
      '--fold-border': 'color-mix(in srgb, red, blue)',
    });
    expect(hex(colors.mountain)).toBe('#778899');
    expect(hex(colors.edge)).toBe('#000000');
  });

  it('folds the theme’s crease alpha into the earlier-crease grey', () => {
    const element = scoped({ '--fold-unassigned': '#aabbcc' });
    const colors = diagramInkColors(element);
    expect(hex(colors.crease)).toBe('#aabbcc');
    expect(colors.crease[3]).toBeCloseTo(0.5, 9);
    // The other greys draw at full strength; only context sits back.
    expect(colors.dotted[3]).toBe(1);
  });

  it('takes the crease alpha as a value when the style sets it, like the inks', () => {
    const element = scoped({});
    expect(diagramInkColors(element, { '--references-crease-alpha': '0.25' }).crease[3]).toBeCloseTo(
      0.25,
      9
    );
    // One it cannot read as a number falls through to the DOM.
    expect(diagramInkColors(element, { '--references-crease-alpha': 'thick' }).crease[3]).toBeCloseTo(
      0.5,
      9
    );
  });
});

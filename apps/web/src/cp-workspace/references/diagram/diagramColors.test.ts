import { afterEach, describe, expect, it } from 'vitest';
import { diagramInkColors, diagramInlineInk, type DiagramInlineTokens } from './diagramColors';

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

describe('diagramInlineInk', () => {
  const tokens: DiagramInlineTokens = {
    '--references-paper-front': '#fff8e1',
    '--references-paper-back': '#d0d0d0',
    '--fold-mountain': '#112233',
    '--fold-valley': '#445566',
    '--fold-border': '#000000',
    '--fold-unassigned': '#aabbcc',
    '--references-crease-alpha': '0.5',
    '--cp-reference-input': '#ff00ff',
    '--bg-primary': '#fafafa',
  };

  it('resolves every style through the same map the canvas uses, off values', () => {
    const ink = diagramInlineInk(tokens, '#405060');
    expect(ink.lines.mountain).toEqual({ color: '#112233' });
    expect(ink.lines['pinch-mountain']).toEqual({ color: '#112233' });
    expect(ink.lines.valley).toEqual({ color: '#445566' });
    expect(ink.lines.edge).toEqual({ color: '#000000' });
    expect(ink.lines.highlight).toEqual({ color: '#ff00ff' });
    expect(ink.lines.dotted).toEqual({ color: '#aabbcc' });
    expect(ink.lines.unfolded).toEqual({ color: '#aabbcc' });
    // The earlier crease sits back by the alpha, as on the canvas.
    expect(ink.lines.crease).toEqual({ color: '#aabbcc', opacity: 0.5 });
    // The arrow is the style's pen, head and glyph included, not the edge's ink.
    expect(ink.lines.arrow).toEqual({ color: '#405060' });
    expect(ink.arrowhead).toBe('#405060');
  });

  it('carries what the classes give the sheet, the wash, a mark and a letter', () => {
    const ink = diagramInlineInk(tokens, '#405060');
    expect(ink.sheet).toEqual({ front: '#fff8e1', back: '#d0d0d0', stroke: '#000000' });
    expect(ink.region).toEqual({ fill: '#ff00ff', opacity: 0.12 });
    expect(ink.mark).toBe('#000000');
    // Every letter in the reference colour, whatever its style: black letters
    // vanished off the sheet and, ringed in the dark ground, smudged on it.
    expect(ink.label).toEqual({
      fill: { normal: '#ff00ff', highlight: '#ff00ff', action: '#ff00ff' },
      halo: '#fafafa',
    });
  });

  it('falls back to the light theme’s crease alpha when the token is not a number', () => {
    const ink = diagramInlineInk({ ...tokens, '--references-crease-alpha': 'thick' }, '#000000');
    expect(ink.lines.crease.opacity).toBe(0.75);
  });
});

import { describe, expect, it } from 'vitest';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE, PAPER_STYLE_FIELDS, paperStyleEquals } from '../../lib/paper/paperStyle';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import {
  DIAGRAM_STYLE_POLICY,
  diagramPaperStyle,
  diagramStyleKey,
  diagramSurfaceStyle,
} from './diagramPaperStyle';
import { digest } from './pictureKey';

describe('the Diagram’s paper style', () => {
  it('starts on the built-in Diagram preset', () => {
    expect(DEFAULT_DIAGRAM_STYLE).toEqual({ preset: 'diagram', style: builtInPaperPreset('diagram').style });
    expect(paperStyleEquals(diagramPaperStyle(DEFAULT_DIAGRAM_STYLE), builtInPaperPreset('diagram').style)).toBe(
      true
    );
  });

  it('applies every field, since a diagram draws every kind of picture', () => {
    expect([...DIAGRAM_STYLE_POLICY.applies].sort()).toEqual([...PAPER_STYLE_FIELDS].sort());
    expect(DIAGRAM_STYLE_POLICY.forced).toBeUndefined();
    // So the Diagram draws a preset's pens exactly as the preset states them.
    const drawn = diagramSurfaceStyle(DEFAULT_DIAGRAM_STYLE);
    expect(paperStyleEquals(drawn, builtInPaperPreset('diagram').style)).toBe(true);
  });

  it('reads a stored style as itself', () => {
    const style = { ...DEFAULT_PAPER_STYLE, erode: 0.01 };
    expect(diagramPaperStyle({ style })).toBe(style);
  });

  it('keys the drawn style: a preset and the same style stored whole share a key', () => {
    const preset = diagramStyleKey({ preset: 'diagram' });
    expect(diagramStyleKey({ style: builtInPaperPreset('diagram').style })).toBe(preset);
    expect(diagramStyleKey({ preset: 'default' })).not.toBe(preset);
    const heavier = builtInPaperPreset('diagram').style;
    expect(diagramStyleKey({ style: { ...heavier, edges: { ...heavier.edges, width: 1 } } })).not.toBe(
      preset
    );
  });
});

describe('digest', () => {
  it('is stable and tells near strings apart', () => {
    expect(digest('abc')).toBe(digest('abc'));
    expect(digest('abc')).not.toBe(digest('abd'));
    expect(digest('')).not.toBe(digest('\u0000'));
  });
});

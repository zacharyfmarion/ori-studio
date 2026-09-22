import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, creaseStyleOf, normalizePaperStyle } from './paperStyle';
import {
  BUILT_IN_PAPER_PRESETS,
  builtInPaperPreset,
  isBuiltInPaperPresetId,
  parsePaperStylePreset,
  serializePaperStylePreset,
  type PaperStylePreset,
} from './paperPresets';

describe('built-in presets', () => {
  it('has the four ids, each already normalised', () => {
    expect(BUILT_IN_PAPER_PRESETS.map((preset) => preset.id)).toEqual([
      'ori-default',
      'oriedita',
      'black-and-white',
      'origami-house',
    ]);
    for (const preset of BUILT_IN_PAPER_PRESETS) {
      expect(preset.version).toBe(1);
      expect(preset.name).not.toBe('');
      // A built-in that the normaliser would change is a built-in with a bad value.
      expect(normalizePaperStyle(JSON.parse(JSON.stringify(preset.style)))).toEqual(preset.style);
    }
  });

  it('starts from the default style', () => {
    expect(builtInPaperPreset('ori-default').style).toBe(DEFAULT_PAPER_STYLE);
    expect(isBuiltInPaperPresetId('oriedita')).toBe(true);
    expect(isBuiltInPaperPresetId('custom')).toBe(false);
  });

  it('transcribes the Origami House template', () => {
    const { style } = builtInPaperPreset('origami-house');
    expect(style.paper).toEqual({ front: '#ffffff', back: '#b3b3b3' });
    expect(style.edges).toEqual({ width: 0.5, color: '#231f20', dash: null, cap: 'butt' });
    expect(style.mountainFolds).toEqual({
      width: 0.75,
      color: '#231f20',
      dash: [8, 2, 1, 2],
      cap: 'butt',
    });
    expect(style.valleyFolds).toEqual({ width: 0.75, color: '#231f20', dash: [4, 2], cap: 'butt' });
    expect(style.auxCreases).toMatchObject({ visible: true, pen: { width: 0.25 } });
    expect(style.arrows.width).toBe(0.75);
    expect(style.light.enabled).toBe(false);
  });

  it('reads black & white as the mono-dashed switch', () => {
    const { style } = builtInPaperPreset('black-and-white');
    expect(creaseStyleOf(style)).toBe('mono-dashed');
    expect(style.mountainFolds.color).toBe(style.edges.color);
  });

  it('gives Oriedita its own paper and CP inks, unlit', () => {
    const { style } = builtInPaperPreset('oriedita');
    expect(style.paper).toEqual(DEFAULT_PAPER_STYLE.paper);
    expect(style.mountainFolds.color).toBe('#ff0000');
    expect(style.valleyFolds.color).toBe('#0000ff');
    // Oriedita's own folded figure never draws aux creases, so its preset hides them.
    expect(style.auxCreases).toMatchObject({ visible: false, pen: { color: '#00ffff' } });
    expect(style.light.enabled).toBe(false);
  });
});

describe('preset files', () => {
  it('serialises and parses back to the same preset', () => {
    const preset: PaperStylePreset = {
      version: 1,
      name: 'Studio',
      author: 'Zach',
      style: builtInPaperPreset('origami-house').style,
    };
    const text = serializePaperStylePreset(preset);
    expect(text.endsWith('\n')).toBe(true);
    expect(parsePaperStylePreset(text)).toEqual({ ok: true, preset });
  });

  it('leaves the author off when there is none', () => {
    const text = serializePaperStylePreset({ version: 1, name: 'Plain', style: DEFAULT_PAPER_STYLE });
    expect(JSON.parse(text)).not.toHaveProperty('author');
    const result = parsePaperStylePreset(text);
    expect(result.ok && result.preset).toEqual({
      version: 1,
      name: 'Plain',
      style: DEFAULT_PAPER_STYLE,
    });
  });

  it('normalises a partial or hand-edited style under the file’s name', () => {
    const result = parsePaperStylePreset(
      JSON.stringify({
        name: '  Sketch  ',
        style: { paper: { front: '#FFFFFF' }, edges: { width: 0.5, color: '#333333' } },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preset.name).toBe('Sketch');
    expect(result.preset.style.paper).toEqual({ front: '#ffffff', back: DEFAULT_PAPER_STYLE.paper.back });
    expect(result.preset.style.edges).toEqual({
      width: 0.5,
      color: '#333333',
      dash: null,
      cap: 'butt',
    });
    expect(result.preset.style.mountainFolds).toEqual(DEFAULT_PAPER_STYLE.mountainFolds);
  });

  it('reports why a file is not a preset', () => {
    expect(parsePaperStylePreset('{')).toEqual({ ok: false, reason: 'invalid-json' });
    expect(parsePaperStylePreset('null')).toEqual({ ok: false, reason: 'not-a-preset' });
    expect(parsePaperStylePreset('"text"')).toEqual({ ok: false, reason: 'not-a-preset' });
    expect(parsePaperStylePreset(JSON.stringify({ style: {} }))).toEqual({
      ok: false,
      reason: 'not-a-preset',
    });
    expect(parsePaperStylePreset(JSON.stringify({ name: '   ', style: {} }))).toEqual({
      ok: false,
      reason: 'not-a-preset',
    });
    // A name alone is a style-less file, and normalising nothing would hand
    // back the defaults under that name.
    expect(parsePaperStylePreset(JSON.stringify({ name: 'Empty' }))).toEqual({
      ok: false,
      reason: 'not-a-preset',
    });
  });
});

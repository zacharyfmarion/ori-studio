import { describe, expect, it } from 'vitest';
import { builtInPaperPreset } from './paper/paperPresets';
import { DEFAULT_PAPER_STYLE, creaseStyleOf } from './paper/paperStyle';
import {
  DEFAULT_PAPER_STYLE_SETTINGS,
  normalizePaperStyleSettings,
  paperStyleFromSimulatorSettings,
  persistedPaperStyleSettings,
} from './paperStyleSettings';

describe('normalizePaperStyleSettings', () => {
  it('reads nothing as the defaults', () => {
    expect(normalizePaperStyleSettings(null)).toBe(DEFAULT_PAPER_STYLE_SETTINGS);
    expect(normalizePaperStyleSettings('paper')).toBe(DEFAULT_PAPER_STYLE_SETTINGS);
  });

  it('round-trips the persisted form', () => {
    const settings = {
      display: { ...DEFAULT_PAPER_STYLE, erode: 0.1 },
      export: builtInPaperPreset('oriedita').style,
      presets: [{ version: 1 as const, name: 'Mine', style: DEFAULT_PAPER_STYLE }],
    };
    const persisted = persistedPaperStyleSettings(settings);
    expect(persisted.version).toBe(1);
    expect(normalizePaperStyleSettings(JSON.parse(JSON.stringify(persisted)))).toEqual(settings);
  });

  it('normalises each style field by field and reads a missing export as following', () => {
    const settings = normalizePaperStyleSettings({
      display: { paper: { front: '#ABCDEF', back: 'yellow' } },
    });
    expect(settings.display.paper).toEqual({ front: '#abcdef', back: DEFAULT_PAPER_STYLE.paper.back });
    expect(settings.export).toBeNull();
    expect(settings.presets).toEqual([]);
  });

  it('drops presets that are not presets, and a second of the same name', () => {
    const { presets } = normalizePaperStyleSettings({
      presets: [
        { name: 'A', style: { erode: 0.1 } },
        { name: '', style: {} },
        { name: 'B' },
        'nope',
        { name: 'A', style: { erode: 0.2 } },
      ],
    });
    expect(presets.map((preset) => preset.name)).toEqual(['A']);
    expect(presets[0]?.style.erode).toBe(0.1);
  });
});

describe('paperStyleFromSimulatorSettings', () => {
  it('is the default style when there were no simulator settings', () => {
    expect(paperStyleFromSimulatorSettings(null)).toBe(DEFAULT_PAPER_STYLE);
    expect(paperStyleFromSimulatorSettings({})).toEqual(DEFAULT_PAPER_STYLE);
  });

  it('maps the colours, treating a theme-following null as the default', () => {
    const style = paperStyleFromSimulatorSettings({
      paperFront: '#ff8800',
      paperBack: null,
      mountainColor: '#111111',
      valleyColor: 'blue',
      borderColor: '#222222',
    });
    expect(style.paper).toEqual({ front: '#ff8800', back: DEFAULT_PAPER_STYLE.paper.back });
    expect(style.mountainFolds.color).toBe('#111111');
    expect(style.valleyFolds.color).toBe(DEFAULT_PAPER_STYLE.valleyFolds.color);
    expect(style.edges.color).toBe('#222222');
  });

  it('states the crease weight in pt on the fold pens and leaves the edge pen alone', () => {
    const style = paperStyleFromSimulatorSettings({ creaseWidth: 2 });
    expect(style.mountainFolds.width).toBeCloseTo(1.5, 9);
    expect(style.valleyFolds.width).toBeCloseTo(1.5, 9);
    expect(style.edges.width).toBe(DEFAULT_PAPER_STYLE.edges.width);
    // The default 1.1 px is exactly the default pen — exactly, because the
    // settings store decides whether to persist the seed by comparing them.
    expect(paperStyleFromSimulatorSettings({ creaseWidth: 1.1 }).mountainFolds.width).toBe(
      DEFAULT_PAPER_STYLE.mountainFolds.width
    );
  });

  it('applies a mono switch after the edge colour, and leaves colour mode to the inks chosen', () => {
    const mono = paperStyleFromSimulatorSettings({ creaseStyle: 'mono', borderColor: '#333333' });
    expect(creaseStyleOf(mono)).toBe('mono');
    expect(mono.mountainFolds.color).toBe('#333333');
    expect(creaseStyleOf(paperStyleFromSimulatorSettings({ creaseStyle: 'mono-dashed' }))).toBe(
      'mono-dashed'
    );
    const color = paperStyleFromSimulatorSettings({ creaseStyle: 'color', mountainColor: '#444444' });
    expect(color.mountainFolds.color).toBe('#444444');
  });

  it('carries the lighting toggle', () => {
    expect(paperStyleFromSimulatorSettings({ lighting: false }).light.enabled).toBe(false);
    expect(paperStyleFromSimulatorSettings({ lighting: 'off' }).light.enabled).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { chosenDiagramStyle, diagramStyleChoices } from './diagramStyleChoices';

const red = { ...DEFAULT_PAPER_STYLE, paper: { front: '#ff0000', back: '#00ff00' } };
const settings = {
  display: DEFAULT_PAPER_STYLE,
  export: null,
  presets: [{ version: 1 as const, name: 'Red', style: red }],
};

describe('diagramStyleChoices', () => {
  it('offers the built-ins by id, then Settings’ export style and saved presets as resolved styles', () => {
    const choices = diagramStyleChoices(settings);
    expect(choices.map((choice) => [choice.id, choice.analytics])).toEqual([
      ['builtin:diagram', 'diagram'],
      ['builtin:default', 'default'],
      ['export-style', 'export-style'],
      [expect.any(String), 'custom'],
    ]);
    expect(choices[0]!.style).toEqual({ preset: 'diagram', style: builtInPaperPreset('diagram').style });
    // The export style follows display while it has none of its own.
    expect(choices[2]!.style).toEqual({ style: DEFAULT_PAPER_STYLE });
    expect(choices[3]).toMatchObject({ presetName: 'Red', style: { style: red } });
  });

  it('names the diagram’s style as the choice that draws it, or none once that is gone', () => {
    const choices = diagramStyleChoices(settings);
    expect(chosenDiagramStyle({ preset: 'default' }, choices)?.id).toBe('builtin:default');
    expect(chosenDiagramStyle({ style: red }, choices)?.presetName).toBe('Red');
    // A resolved style never reads as a built-in, even one drawn the same.
    expect(chosenDiagramStyle({ style: builtInPaperPreset('diagram').style }, choices)).toBeNull();
    expect(chosenDiagramStyle({ style: { ...red, erode: 0.2 } }, choices)).toBeNull();
  });
});

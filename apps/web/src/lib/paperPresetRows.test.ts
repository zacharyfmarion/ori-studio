import { describe, expect, it } from 'vitest';
import { BUILT_IN_PAPER_PRESETS, builtInPaperPreset } from './paper/paperPresets';
import { DEFAULT_PAPER_STYLE } from './paper/paperStyle';
import { paperPresetRows, paperSlotPreset } from './paperPresetRows';

const MINE = { version: 1 as const, name: 'Mine', style: { ...DEFAULT_PAPER_STYLE, erode: 0.01 } };
const ROWS = paperPresetRows([MINE]);
const DIAGRAM = builtInPaperPreset('diagram').style;
const none = { display: null, export: null };

describe('paperPresetRows', () => {
  it('lists the built-ins first, then the saved presets, keyed as the store keys them', () => {
    expect(ROWS.map((row) => row.key)).toEqual([
      ...BUILT_IN_PAPER_PRESETS.map((preset) => `builtin:${preset.id}`),
      'user:Mine',
    ]);
    expect(ROWS.at(-1)?.builtIn).toBeNull();
  });
});

describe('paperSlotPreset', () => {
  it('names the preset a slot was last set from, and whether it has been edited since', () => {
    const settings = {
      display: { ...DIAGRAM, erode: 0.02 },
      export: null,
      appliedPreset: { ...none, display: 'builtin:diagram' },
    };
    const slot = paperSlotPreset(settings, 'display', ROWS);
    expect(slot.applied?.builtIn).toBe('diagram');
    expect(slot.modified).toBe(true);
  });

  it('with nothing recorded, names the preset the style is, field for field', () => {
    const slot = paperSlotPreset({ display: DEFAULT_PAPER_STYLE, export: null, appliedPreset: none }, 'display', ROWS);
    expect(slot.applied?.builtIn).toBe('default');
    expect(slot.modified).toBe(false);
  });

  it('names nobody’s preset for a style that is no preset’s', () => {
    const slot = paperSlotPreset(
      { display: { ...DEFAULT_PAPER_STYLE, erode: 0.03 }, export: null, appliedPreset: none },
      'display',
      ROWS
    );
    expect(slot).toEqual({ applied: null, modified: false });
  });

  it('speaks for display on the export slot while it follows, and for its own once set apart', () => {
    const following = { display: DIAGRAM, export: null, appliedPreset: { ...none, display: 'builtin:diagram' } };
    expect(paperSlotPreset(following, 'export', ROWS).applied?.builtIn).toBe('diagram');
    const apart = { ...following, export: MINE.style, appliedPreset: { display: 'builtin:diagram', export: 'user:Mine' } };
    expect(paperSlotPreset(apart, 'export', ROWS).applied?.key).toBe('user:Mine');
  });
});

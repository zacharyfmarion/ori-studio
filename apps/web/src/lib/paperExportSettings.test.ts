import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PAGE, DEFAULT_PAPER_SIZE_MM } from './paper/paperPage';
import { DEFAULT_PAPER_PNG_DPI, PAPER_PNG_DPI_RANGE } from './paper/paperPng';
import type { PaperExportSurface } from '../analytics/events';
import {
  DEFAULT_PAPER_EXPORT_MARKS,
  DEFAULT_PAPER_EXPORT_SETTINGS,
  PAPER_EXPORT_KINDS,
  clampPaperPngDpi,
  normalizePaperExportMarks,
  normalizePaperExportMemory,
  normalizePaperExportSettings,
  paperExportFromSimulatorSettings,
  paperExportKindOf,
  paperExportMemoryOf,
  paperPageOf,
  persistedPaperExport,
  type PaperExportKind,
  type PaperExportSettings,
} from './paperExportSettings';

describe('normalizePaperExportSettings', () => {
  it('persists OBJ for simulations alone without losing image settings', () => {
    const options = { ...DEFAULT_PAPER_EXPORT_SETTINGS, format: 'obj', paddingMm: 7, pngDpi: 300 };
    expect(normalizePaperExportSettings(options, 'simulation')).toEqual(options);
    expect(normalizePaperExportSettings(options, 'step').format).toBe('svg');
    expect(normalizePaperExportSettings(options, 'folded-figure').format).toBe('svg');
    const memory = normalizePaperExportMemory({ version: 2, kinds: {
      simulation: options, 'folded-figure': options, step: options,
    } });
    expect(memory.simulation).toEqual(options);
    expect(memory.step).toMatchObject({ format: 'svg', paddingMm: 7, pngDpi: 300 });
    expect(memory['folded-figure'].format).toBe('svg');
  });
  it('reads nothing as the defaults', () => {
    expect(normalizePaperExportSettings(null)).toBe(DEFAULT_PAPER_EXPORT_SETTINGS);
    expect(normalizePaperExportSettings('page')).toBe(DEFAULT_PAPER_EXPORT_SETTINGS);
    expect(DEFAULT_PAPER_EXPORT_SETTINGS).toEqual({
      ...DEFAULT_PAPER_PAGE,
      pngDpi: DEFAULT_PAPER_PNG_DPI,
      format: 'svg',
      style: 'export-style',
      marks: { letters: true, highlights: true },
    });
  });

  it('round-trips a complete page', () => {
    const settings = {
      sheet: { mm: 150 },
      paddingMm: 2.5,
      background: '#ffffff',
      keepHiddenFaces: false,
      pngDpi: 300,
      format: 'png',
      style: 'builtin:diagram',
      marks: { letters: false, highlights: true },
    };
    expect(normalizePaperExportSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it('reads a page saved before the dialog remembered anything as the export slot, in SVG', () => {
    const settings = normalizePaperExportSettings({ paddingMm: 5, pngDpi: 192 });
    expect(settings.format).toBe('svg');
    expect(settings.style).toBe('export-style');
  });

  it('drops a format it does not know and an empty style', () => {
    const settings = normalizePaperExportSettings({ format: 'pdf', style: '' });
    expect(settings.format).toBe('svg');
    expect(settings.style).toBe('export-style');
  });

  it('normalises the page field by field and clamps the density', () => {
    const settings = normalizePaperExportSettings({
      sheet: { mm: 'big' },
      background: '#123456',
      keepHiddenFaces: 'yes',
      pngDpi: 5000,
    });
    expect(settings.sheet).toEqual(DEFAULT_PAPER_PAGE.sheet);
    expect(settings.background).toBe('#123456');
    expect(settings.keepHiddenFaces).toBe(true);
    expect(settings.pngDpi).toBe(PAPER_PNG_DPI_RANGE.max);
    expect(normalizePaperExportSettings({ pngDpi: 'high' }).pngDpi).toBe(DEFAULT_PAPER_PNG_DPI);
  });
});

describe('normalizePaperExportMarks', () => {
  it('shows every mark when options from before the marks have none', () => {
    expect(normalizePaperExportSettings({ paddingMm: 5 }).marks).toEqual(DEFAULT_PAPER_EXPORT_MARKS);
    for (const source of [null, undefined, 'letters', 3, true]) {
      expect(normalizePaperExportMarks(source)).toEqual({ letters: true, highlights: true });
    }
  });

  it('reads each mark on its own: a missing or non-boolean one is shown', () => {
    expect(normalizePaperExportMarks({ letters: false })).toEqual({ letters: false, highlights: true });
    // Only `false` hides a mark: a falsy value of another type is not a choice.
    expect(normalizePaperExportMarks({ letters: 0, highlights: '' })).toEqual({
      letters: true,
      highlights: true,
    });
    expect(normalizePaperExportMarks({ letters: 'no', highlights: false })).toEqual({
      letters: true,
      highlights: false,
    });
    expect(normalizePaperExportMarks({ letters: false, highlights: false, arrows: false })).toEqual({
      letters: false,
      highlights: false,
    });
  });
});

describe('clampPaperPngDpi', () => {
  it('holds the density inside the range and rounds it to whole dots', () => {
    expect(clampPaperPngDpi(1)).toBe(PAPER_PNG_DPI_RANGE.min);
    expect(clampPaperPngDpi(99.6)).toBe(100);
    expect(clampPaperPngDpi(Number.NaN)).toBe(DEFAULT_PAPER_PNG_DPI);
  });
});

describe('paperPageOf', () => {
  it('is the page without the density', () => {
    const settings = { ...DEFAULT_PAPER_EXPORT_SETTINGS, pngDpi: 300 };
    expect(paperPageOf(settings)).toEqual(DEFAULT_PAPER_PAGE);
  });
});

describe('paperExportFromSimulatorSettings', () => {
  it('carries a white export background across as a white page', () => {
    expect(paperExportFromSimulatorSettings({ exportBackground: 'white' })).toEqual({
      ...DEFAULT_PAPER_EXPORT_SETTINGS,
      background: '#ffffff',
    });
  });

  it('reads transparent, theme, absent and nonsense alike as a transparent page', () => {
    for (const source of [
      { exportBackground: 'transparent' },
      { exportBackground: 'theme' },
      { showViewCube: false },
      { exportBackground: 42 },
      null,
    ]) {
      expect(paperExportFromSimulatorSettings(source)).toBe(DEFAULT_PAPER_EXPORT_SETTINGS);
    }
  });
});

const SIMULATION_OPTIONS: PaperExportSettings = {
  sheet: { mm: 150 },
  paddingMm: 2.5,
  background: '#ffffff',
  keepHiddenFaces: false,
  pngDpi: 600,
  format: 'png',
  style: 'builtin:diagram',
  marks: DEFAULT_PAPER_EXPORT_MARKS,
};

const STEP_OPTIONS: PaperExportSettings = {
  ...DEFAULT_PAPER_EXPORT_SETTINGS,
  paddingMm: 10,
  pngDpi: 150,
  style: 'user:Mine',
  marks: { letters: false, highlights: false },
};

/** Every kind's first-run options: the defaults, at the one default size. */
const FIRST_RUN = paperExportMemoryOf(DEFAULT_PAPER_EXPORT_SETTINGS);

describe('paperExportKindOf', () => {
  it('remembers each surface’s options as its kind', () => {
    const kinds: Record<PaperExportSurface, PaperExportKind> = {
      simulator: 'simulation',
      'inline-simulation': 'simulation',
      'folded-3d': 'folded-figure',
      'folded-flat': 'folded-figure',
      references: 'step',
    };
    for (const [surface, kind] of Object.entries(kinds)) {
      expect(paperExportKindOf(surface as PaperExportSurface)).toBe(kind);
    }
  });

  it('gives every kind at least one surface', () => {
    const surfaces: PaperExportSurface[] = [
      'simulator',
      'inline-simulation',
      'folded-3d',
      'folded-flat',
      'references',
    ];
    expect(new Set(surfaces.map(paperExportKindOf))).toEqual(new Set(PAPER_EXPORT_KINDS));
  });
});

describe('paperExportMemoryOf', () => {
  it('puts every kind on the same options', () => {
    const memory = paperExportMemoryOf(SIMULATION_OPTIONS);
    expect(Object.keys(memory).sort()).toEqual([...PAPER_EXPORT_KINDS].sort());
    for (const kind of PAPER_EXPORT_KINDS) expect(memory[kind]).toEqual(SIMULATION_OPTIONS);
  });
});

describe('every kind’s first run', () => {
  it('opens every kind at 50 mm: a step’s sheet, a figure across its longer side', () => {
    expect(DEFAULT_PAPER_SIZE_MM).toBe(50);
    expect(DEFAULT_PAPER_EXPORT_SETTINGS.sheet).toEqual({ mm: DEFAULT_PAPER_SIZE_MM });
    for (const kind of PAPER_EXPORT_KINDS) expect(FIRST_RUN[kind]).toEqual(DEFAULT_PAPER_EXPORT_SETTINGS);
  });
});

describe('normalizePaperExportMemory', () => {
  it('reads a v2 value kind by kind', () => {
    const kinds = {
      simulation: SIMULATION_OPTIONS,
      'folded-figure': DEFAULT_PAPER_EXPORT_SETTINGS,
      step: STEP_OPTIONS,
    };
    const stored = JSON.parse(JSON.stringify({ version: 2, kinds }));
    expect(normalizePaperExportMemory(stored)).toEqual(kinds);
  });

  it('normalises each kind on its own, clamping what is out of range', () => {
    const memory = normalizePaperExportMemory({
      version: 2,
      kinds: { simulation: { ...SIMULATION_OPTIONS, pngDpi: 5000 }, step: STEP_OPTIONS },
    });
    expect(memory.simulation).toEqual({ ...SIMULATION_OPTIONS, pngDpi: PAPER_PNG_DPI_RANGE.max });
    expect(memory.step).toEqual(STEP_OPTIONS);
  });

  it('gives a malformed kind its own first-run options alone, and the others keep theirs', () => {
    const memory = normalizePaperExportMemory({
      version: 2,
      kinds: { simulation: SIMULATION_OPTIONS, 'folded-figure': 'broken', step: STEP_OPTIONS },
    });
    expect(memory['folded-figure']).toEqual(FIRST_RUN['folded-figure']);
    expect(memory.simulation).toEqual(SIMULATION_OPTIONS);
    expect(memory.step).toEqual(STEP_OPTIONS);
    const missing = normalizePaperExportMemory({
      version: 2,
      kinds: { 'folded-figure': SIMULATION_OPTIONS },
    });
    expect(missing).toEqual({ ...FIRST_RUN, 'folded-figure': SIMULATION_OPTIONS });
  });

  // There is no "as shown" any more: a kind that remembers one from an older
  // build opens at the default size.
  it('reads a remembered “as shown” as the default size', () => {
    const figure = { ...DEFAULT_PAPER_EXPORT_SETTINGS, sheet: 'as-shown' };
    const memory = normalizePaperExportMemory({ version: 2, kinds: { 'folded-figure': figure } });
    expect(memory['folded-figure'].sheet).toEqual(DEFAULT_PAPER_PAGE.sheet);
  });

  it('reads only the kinds it knows, so an unknown one is not written back', () => {
    const memory = normalizePaperExportMemory({
      version: 2,
      kinds: { simulation: SIMULATION_OPTIONS, step: STEP_OPTIONS, sketch: STEP_OPTIONS },
    });
    expect(Object.keys(memory).sort()).toEqual([...PAPER_EXPORT_KINDS].sort());
  });

  it('reads a value from a newer build as the first-run options', () => {
    expect(
      normalizePaperExportMemory({ version: 3, kinds: { simulation: SIMULATION_OPTIONS } })
    ).toEqual(FIRST_RUN);
  });

  it('gives every kind its first-run options when a v2 value has no kinds to read', () => {
    for (const kinds of [undefined, null, 'kinds', 7]) {
      expect(normalizePaperExportMemory({ version: 2, kinds })).toEqual(FIRST_RUN);
    }
  });

  it('seeds every kind with a pre-split object’s page, at the default format and style', () => {
    const memory = normalizePaperExportMemory(SIMULATION_OPTIONS);
    const seeded = {
      ...paperPageOf(SIMULATION_OPTIONS),
      pngDpi: SIMULATION_OPTIONS.pngDpi,
      format: DEFAULT_PAPER_EXPORT_SETTINGS.format,
      style: DEFAULT_PAPER_EXPORT_SETTINGS.style,
      marks: DEFAULT_PAPER_EXPORT_MARKS,
    };
    expect(memory).toEqual(paperExportMemoryOf(seeded));
  });

  it('reads nothing as every kind’s first-run options', () => {
    const firstRun = { ...DEFAULT_PAPER_EXPORT_SETTINGS, background: '#ffffff' };
    for (const source of [null, undefined, 'page', 0]) {
      expect(normalizePaperExportMemory(source, firstRun)).toEqual(paperExportMemoryOf(firstRun));
      expect(normalizePaperExportMemory(source)).toEqual(FIRST_RUN);
    }
  });

  it('seeds from a stored object, not the first-run options', () => {
    const firstRun = { ...DEFAULT_PAPER_EXPORT_SETTINGS, background: '#ffffff' };
    const memory = normalizePaperExportMemory({ background: null, pngDpi: 300 }, firstRun);
    for (const kind of PAPER_EXPORT_KINDS) {
      expect(memory[kind].background).toBeNull();
      expect(memory[kind].pngDpi).toBe(300);
    }
  });
});

describe('persistedPaperExport', () => {
  it('stores the memory as version 2, which reads back as itself', () => {
    const memory = { ...paperExportMemoryOf(DEFAULT_PAPER_EXPORT_SETTINGS), step: STEP_OPTIONS };
    const persisted = persistedPaperExport(memory);
    expect(persisted).toEqual({ version: 2, kinds: memory });
    expect(normalizePaperExportMemory(JSON.parse(JSON.stringify(persisted)))).toEqual(memory);
  });

  it('reads as the defaults, without throwing, in a build from before the split', () => {
    const persisted = persistedPaperExport(paperExportMemoryOf(SIMULATION_OPTIONS));
    const stored = JSON.parse(JSON.stringify(persisted));
    expect(() => normalizePaperExportSettings(stored)).not.toThrow();
    expect(normalizePaperExportSettings(stored)).toEqual(DEFAULT_PAPER_EXPORT_SETTINGS);
  });
});

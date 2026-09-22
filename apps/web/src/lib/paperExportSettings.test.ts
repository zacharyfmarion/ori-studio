import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PAGE } from './paper/paperPage';
import { DEFAULT_PAPER_PNG_DPI, PAPER_PNG_DPI_RANGE } from './paper/paperPng';
import {
  DEFAULT_PAPER_EXPORT_SETTINGS,
  clampPaperPngDpi,
  normalizePaperExportSettings,
  paperExportFromSimulatorSettings,
  paperPageOf,
} from './paperExportSettings';

describe('normalizePaperExportSettings', () => {
  it('reads nothing as the defaults', () => {
    expect(normalizePaperExportSettings(null)).toBe(DEFAULT_PAPER_EXPORT_SETTINGS);
    expect(normalizePaperExportSettings('page')).toBe(DEFAULT_PAPER_EXPORT_SETTINGS);
    expect(DEFAULT_PAPER_EXPORT_SETTINGS).toEqual({ ...DEFAULT_PAPER_PAGE, pngDpi: DEFAULT_PAPER_PNG_DPI });
  });

  it('round-trips a complete page', () => {
    const settings = {
      sheet: { mm: 150 },
      paddingMm: 2.5,
      background: '#ffffff',
      keepHiddenFaces: false,
      pngDpi: 300,
    };
    expect(normalizePaperExportSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it('normalises the page field by field and clamps the density', () => {
    const settings = normalizePaperExportSettings({
      sheet: { mm: 'big' },
      background: '#123456',
      keepHiddenFaces: 'yes',
      pngDpi: 5000,
    });
    expect(settings.sheet).toBe('as-shown');
    expect(settings.background).toBe('#123456');
    expect(settings.keepHiddenFaces).toBe(true);
    expect(settings.pngDpi).toBe(PAPER_PNG_DPI_RANGE.max);
    expect(normalizePaperExportSettings({ pngDpi: 'high' }).pngDpi).toBe(DEFAULT_PAPER_PNG_DPI);
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
    expect(paperPageOf({ ...DEFAULT_PAPER_EXPORT_SETTINGS, pngDpi: 300 })).toEqual(DEFAULT_PAPER_PAGE);
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

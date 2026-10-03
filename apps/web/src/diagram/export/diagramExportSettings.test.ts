import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_EXPORT_SETTINGS, normalizeDiagramExportSettings } from './diagramExportSettings';
import { STEP_FILE_MM_RANGE, stepFileMinHeightMm } from './stepFileGeometry';

describe('normalizeDiagramExportSettings', () => {
  it('reads anything that is not settings as the defaults', () => {
    for (const value of [null, undefined, 'pdf', 42, []]) {
      expect(normalizeDiagramExportSettings(value)).toEqual(DEFAULT_DIAGRAM_EXPORT_SETTINGS);
    }
  });

  it('keeps what reads, and takes the default for each field that does not', () => {
    expect(
      normalizeDiagramExportSettings({
        kind: 'steps',
        pdf: 'print-shop',
        format: 'png',
        dpi: 600,
        number: false,
        text: 'yes',
        sameSize: false,
        widthMm: 120,
        heightMm: 'tall',
        transparent: false,
      })
    ).toEqual({
      kind: 'steps',
      pdf: 'print-shop',
      format: 'png',
      dpi: 600,
      number: false,
      text: true,
      sameSize: false,
      widthMm: 120,
      heightMm: 100,
      transparent: false,
    });
    expect(normalizeDiagramExportSettings({ kind: 'docx', dpi: 72 })).toMatchObject({ kind: 'pdf', dpi: 300 });
  });

  it('holds the canvas to its range, tall enough for the number and the text it carries', () => {
    const tiny = normalizeDiagramExportSettings({ widthMm: 1, heightMm: 1, number: true, text: true });
    expect(tiny.widthMm).toBe(STEP_FILE_MM_RANGE.min);
    expect(tiny.heightMm).toBe(Math.ceil(stepFileMinHeightMm({ number: true, text: true })));
    const bare = normalizeDiagramExportSettings({ heightMm: 1, number: false, text: false });
    expect(bare.heightMm).toBeLessThan(tiny.heightMm);
    expect(normalizeDiagramExportSettings({ widthMm: 9000 }).widthMm).toBe(STEP_FILE_MM_RANGE.max);
  });
});

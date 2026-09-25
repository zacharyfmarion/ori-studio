import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The export dialog's events carry enums only: which surface, which format,
 * which kind of style and page — never a colour, a size in mm or a name.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackPaperExported, trackPaperExportOpened } = await import('../trackPaperExport');

const SVG = {
  surface: 'references',
  format: 'svg',
  hiddenFaces: 'kept',
  style: 'export-style',
  sheet: 'as-shown',
  background: 'transparent',
  pngDpi: 192,
  optionsChanged: false,
  scope: 'this',
  pageCount: 1,
} as const;

beforeEach(() => {
  runtime.track.mockClear();
});

describe('trackPaperExportOpened', () => {
  it('names the surface', () => {
    trackPaperExportOpened('references', 'all');
    expect(runtime.track).toHaveBeenCalledWith('paper export opened', {
      surface: 'references',
      scope: 'all',
    });
  });
});

describe('trackPaperExported', () => {
  it('reports every option as an enum, and no resolution for an SVG', () => {
    trackPaperExported(SVG);
    expect(runtime.track).toHaveBeenCalledWith('paper exported', {
      surface: 'references',
      format: 'svg',
      hidden_faces: 'kept',
      style: 'export-style',
      sheet: 'as-shown',
      background: 'transparent',
      resolution: 'none',
      options_changed: 'no',
      scope: 'this',
    });
  });

  it('buckets how many pages an export of every step wrote', () => {
    trackPaperExported({ ...SVG, scope: 'all', pageCount: 12 });
    const properties = runtime.track.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(properties).toMatchObject({ scope: 'all', page_count_bucket: '<=25' });
    expect(Object.values(properties)).not.toContain(12);
  });

  it('names a PNG’s density by the picker’s preset, and any other as custom', () => {
    trackPaperExported({ ...SVG, format: 'png', pngDpi: 288, optionsChanged: true });
    expect(runtime.track.mock.calls[0]?.[1]).toMatchObject({ resolution: '3x', options_changed: 'yes' });
    trackPaperExported({ ...SVG, format: 'png', pngDpi: 250 });
    const properties = runtime.track.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(properties.resolution).toBe('custom');
    expect(Object.values(properties)).not.toContain(250);
  });
});

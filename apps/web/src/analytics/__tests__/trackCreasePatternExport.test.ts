import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { creasePatternSpreadProperties, trackCreasePatternExported } = await import('../trackCreasePatternExport');

beforeEach(() => {
  runtime.track.mockClear();
});

describe('trackCreasePatternExported', () => {
  it('sends the format and the folded figure’s style, and nothing else', () => {
    trackCreasePatternExported({ format: 'png', foldedFigure: 'diagram' });
    expect(runtime.track).toHaveBeenCalledTimes(1);
    expect(runtime.track).toHaveBeenCalledWith('crease pattern exported', {
      format: 'png',
      folded_figure: 'diagram',
      folded_figure_layer_order: 'default',
      folded_figure_spread: 'none',
    });
  });

  it('reports a pattern saved without a figure as none', () => {
    trackCreasePatternExported({ format: 'svg', foldedFigure: 'none' });
    expect(runtime.track).toHaveBeenCalledWith('crease pattern exported', {
      format: 'svg',
      folded_figure: 'none',
      folded_figure_layer_order: 'default',
      folded_figure_spread: 'none',
    });
  });

  it('says when the figure is in a layer order chosen in the Layer order dialog', () => {
    trackCreasePatternExported({ format: 'svg', foldedFigure: 'export-style', layerOrder: 'chosen' });
    expect(runtime.track).toHaveBeenCalledWith('crease pattern exported', {
      format: 'svg',
      folded_figure: 'export-style',
      folded_figure_layer_order: 'chosen',
      folded_figure_spread: 'none',
    });
  });

  it('says how the figure’s layers were spread in the file, and whether as vector or a bitmap', () => {
    trackCreasePatternExported({ format: 'svg', foldedFigure: 'diagram', spread: { kind: 'connected', render: 'raster' } });
    expect(runtime.track).toHaveBeenLastCalledWith('crease pattern exported', {
      format: 'svg',
      folded_figure: 'diagram',
      folded_figure_layer_order: 'default',
      folded_figure_spread: 'connected',
      spread_render: 'raster',
    });
    // Enums only: never an amount, a reveal or a direction.
    for (const [, sent] of runtime.track.mock.calls) {
      expect(Object.values(sent as Record<string, unknown>).every((value) => typeof value === 'string')).toBe(true);
    }
  });
});

describe('creasePatternSpreadProperties', () => {
  it('names the kind and how it was written, and sends no render without a spread', () => {
    expect(creasePatternSpreadProperties({ kind: 'affine', render: 'vector' })).toEqual({
      folded_figure_spread: 'affine',
      spread_render: 'vector',
    });
    expect(creasePatternSpreadProperties(null)).toEqual({ folded_figure_spread: 'none' });
  });
});

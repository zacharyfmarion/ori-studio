import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackCreasePatternExported } = await import('../trackCreasePatternExport');

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
    });
  });

  it('reports a pattern saved without a figure as none', () => {
    trackCreasePatternExported({ format: 'svg', foldedFigure: 'none' });
    expect(runtime.track).toHaveBeenCalledWith('crease pattern exported', {
      format: 'svg',
      folded_figure: 'none',
    });
  });
});

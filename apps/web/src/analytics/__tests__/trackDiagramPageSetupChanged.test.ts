import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A page setting's event names the setting, never its value: the style only
 * as a built-in, the export style or `custom`, the title block's model or
 * pattern only as where it now comes from — never which step — and its text
 * and sizes only as what changed on the page: never the words, never a size.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackDiagramPageSetupChanged } = await import('../trackDiagram');

beforeEach(() => {
  runtime.track.mockClear();
});

describe('trackDiagramPageSetupChanged', () => {
  it('sends the setting alone', () => {
    trackDiagramPageSetupChanged('title_block');
    trackDiagramPageSetupChanged('page_numbers');
    expect(runtime.track.mock.calls).toEqual([
      ['diagram page setup changed', { setting: 'title_block' }],
      ['diagram page setup changed', { setting: 'page_numbers' }],
    ]);
  });

  it('sends the style as named', () => {
    trackDiagramPageSetupChanged('style', { style: 'export-style' });
    expect(runtime.track).toHaveBeenCalledWith('diagram page setup changed', { setting: 'style', style: 'export-style' });
  });

  it('sends where the title block’s model or pattern now comes from', () => {
    trackDiagramPageSetupChanged('title_block_model', { titleBlockChoice: 'step' });
    trackDiagramPageSetupChanged('title_block_pattern', { titleBlockChoice: 'none' });
    expect(runtime.track.mock.calls).toEqual([
      ['diagram page setup changed', { setting: 'title_block_model', title_block_choice: 'step' }],
      ['diagram page setup changed', { setting: 'title_block_pattern', title_block_choice: 'none' }],
    ]);
  });

  it('sends a crease pattern uploaded for the title block by its format, never its name', () => {
    trackDiagramPageSetupChanged('title_block_pattern', { titleBlockChoice: 'upload', titleBlockPatternFormat: 'fold' });
    expect(runtime.track.mock.calls).toEqual([
      ['diagram page setup changed', { setting: 'title_block_pattern', title_block_choice: 'upload', title_block_pattern_format: 'fold' }],
    ]);
  });

  it('sends whether the title block’s subtitle or note prints, never its words', () => {
    trackDiagramPageSetupChanged('title_block_subtitle', { titleBlockSubtitle: 'hidden' });
    trackDiagramPageSetupChanged('title_block_note', { titleBlockNote: 'shown' });
    expect(runtime.track.mock.calls).toEqual([
      ['diagram page setup changed', { setting: 'title_block_subtitle', title_block_subtitle: 'hidden' }],
      ['diagram page setup changed', { setting: 'title_block_note', title_block_note: 'shown' }],
    ]);
  });

  it('sends how the credits changed and how many there are, bucketed', () => {
    trackDiagramPageSetupChanged('title_block_credits', { titleBlockCreditChange: 'add', titleBlockCredits: 4 });
    trackDiagramPageSetupChanged('title_block_credits', { titleBlockCreditChange: 'remove', titleBlockCredits: 0 });
    trackDiagramPageSetupChanged('title_block_credits', { titleBlockCreditChange: 'step_count_off', titleBlockCredits: 3 });
    trackDiagramPageSetupChanged('title_block_credits', { titleBlockCreditChange: 'label', titleBlockCredits: 12 });
    expect(runtime.track.mock.calls.map(([, properties]) => properties)).toEqual([
      { setting: 'title_block_credits', title_block_credit_change: 'add', title_block_credit_bucket: '<=5' },
      { setting: 'title_block_credits', title_block_credit_change: 'remove', title_block_credit_bucket: '<=0' },
      { setting: 'title_block_credits', title_block_credit_change: 'step_count_off', title_block_credit_bucket: '<=3' },
      { setting: 'title_block_credits', title_block_credit_change: 'label', title_block_credit_bucket: '>10' },
    ]);
  });

  it('sends whether a size is the default, never the size', () => {
    trackDiagramPageSetupChanged('title_block_model_size', { titleBlockSize: 'custom' });
    trackDiagramPageSetupChanged('title_block_pattern_size', { titleBlockSize: 'default' });
    expect(runtime.track.mock.calls).toEqual([
      ['diagram page setup changed', { setting: 'title_block_model_size', title_block_size: 'custom' }],
      ['diagram page setup changed', { setting: 'title_block_pattern_size', title_block_size: 'default' }],
    ]);
  });

  it('sends whether the band follows the paper’s colour, never the colour', () => {
    trackDiagramPageSetupChanged('title_block_band_color', { titleBlockBand: 'custom' });
    trackDiagramPageSetupChanged('title_block_band_color', { titleBlockBand: 'paper' });
    expect(runtime.track.mock.calls).toEqual([
      ['diagram page setup changed', { setting: 'title_block_band_color', title_block_band: 'custom' }],
      ['diagram page setup changed', { setting: 'title_block_band_color', title_block_band: 'paper' }],
    ]);
  });
});

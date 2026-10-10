import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Make Marks Editable's event (17e) says where it was pressed and how many
 * marks it lifted, bucketed: never a mark, nor the count itself.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackDiagramReferencesMarksLifted } = await import('../trackDiagram');

beforeEach(() => {
  runtime.track.mockClear();
});

describe('trackDiagramReferencesMarksLifted', () => {
  it('sends where it was pressed and the marks it lifted, bucketed', () => {
    trackDiagramReferencesMarksLifted('annotate_notice', 9);
    expect(runtime.track).toHaveBeenCalledWith('diagram references marks lifted', { via: 'annotate_notice', count_bucket: '<=10' });
    trackDiagramReferencesMarksLifted('card_menu', 480);
    expect(runtime.track).toHaveBeenLastCalledWith('diagram references marks lifted', { via: 'card_menu', count_bucket: '<=500' });
  });
});

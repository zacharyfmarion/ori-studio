import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A mark's own option changed in the Layers pane (Revision 3) says the mark's
 * kind, which option and what it became, by name: never where the mark is.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackDiagramMarkStyled } = await import('../trackDiagram');

beforeEach(() => {
  runtime.track.mockClear();
});

describe('trackDiagramMarkStyled', () => {
  it('sends the mark, the option and the value, and nothing else', () => {
    trackDiagramMarkStyled('divisions', 'short_dividers', 'on');
    expect(runtime.track).toHaveBeenCalledWith('diagram mark styled', { mark: 'divisions', option: 'short_dividers', value: 'on' });
    trackDiagramMarkStyled('divisions', 'short_dividers', 'off');
    expect(runtime.track).toHaveBeenLastCalledWith('diagram mark styled', { mark: 'divisions', option: 'short_dividers', value: 'off' });
  });
});

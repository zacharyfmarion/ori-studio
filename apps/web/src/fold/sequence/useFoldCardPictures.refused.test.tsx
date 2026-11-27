import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONNECTED_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { documentPaperStyleOf } from '../../lib/paper/documentPaperStyle';
import { SpreadRefusal } from '../../layer-spread/spreadRefusal';
import { FOLD_DEFAULT_PAPER_STYLE } from '../document/foldSequenceDocument';
import { bookScene } from '../canvas/foldCanvas.fixtures';
import { FOLD_PANE_DISPLAY_DEFAULT } from '../canvas/foldPaneScenes';
import { foldStatePictureUrl } from '../canvas/foldStatePicture';
import type { FoldSession } from '../session/foldSession';

/**
 * A card spread by Default whose state the spread refuses — a model past the
 * solve's resource limits, its time budget or its preparation budget
 * (ORI-STUDIO-1H) — shows the state unspread, as the folded pane does, and
 * is counted rather than reported. Anything else the spread throws is still
 * an error: the card says it can't be drawn, and the failure is reported.
 *
 * Over the real picture (`connectedFoldStatePictureUrl`, settled flat by
 * `settledSpreadPicture`); only the solve's lease is made to fail.
 */

const solve = vi.hoisted(() => ({ fails: null as unknown }));
vi.mock('../../layer-spread/prepareConnected', () => ({
  prepareConnected: () => {
    const promise = Promise.reject(solve.fails);
    void promise.catch(() => {});
    return { promise, release: () => {} };
  },
}));
const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../monitoring')>()),
  reportError: monitoring.reportError,
}));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../analytics/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/runtime')>()),
  track: analytics.track,
}));
vi.mock('../../store/workspaceStore/foldSession', () => ({ foldSession: () => null }));

const { clearFoldCardPictures, foldCardPictureSource, heldFoldCardPicture, requestFoldCardPicture } = await import(
  './useFoldCardPictures'
);

const scene = bookScene();
const session = { peek: () => ({ value: scene }), query: vi.fn() } as unknown as FoldSession;
const STYLE = documentPaperStyleOf(FOLD_DEFAULT_PAPER_STYLE);
const DISPLAY = FOLD_PANE_DISPLAY_DEFAULT;

function card(fingerprint: string) {
  const source = foldCardPictureSource({ generation: 1, id: 1 }, fingerprint, DEFAULT_CONNECTED_SPREAD);
  if (!source) throw new Error('no source');
  return source;
}

afterEach(() => {
  clearFoldCardPictures();
  monitoring.reportError.mockClear();
  analytics.track.mockClear();
});

describe('a card whose Default spread the spread refuses', () => {
  it('shows its state unspread, reports nothing, and counts the refusal once per kind', async () => {
    solve.fails = new SpreadRefusal('resource_limit', 'Spread resource limit exceeded: overlap regions');
    const first = card('fs1:first');
    const second = card('fs1:second');
    requestFoldCardPicture(session, first, STYLE, DISPLAY);
    requestFoldCardPicture(session, second, STYLE, DISPLAY);
    const unspread = foldStatePictureUrl(scene, STYLE, DISPLAY, null);
    expect(unspread).toMatch(/^data:image\/svg\+xml/);
    await vi.waitFor(() => expect(heldFoldCardPicture(second, STYLE, DISPLAY)).toBe(unspread));
    expect(heldFoldCardPicture(first, STYLE, DISPLAY)).toBe(unspread);
    expect(monitoring.reportError).not.toHaveBeenCalled();
    // Two cards met the same limit: one count of it.
    expect(analytics.track).toHaveBeenCalledOnce();
    expect(analytics.track).toHaveBeenCalledWith('fold spread refused', { reason: 'resource_limit' });

    // Another kind of refusal is counted on its own.
    solve.fails = new SpreadRefusal('time_budget', 'Layer spread exceeded its time budget');
    const third = card('fs1:third');
    requestFoldCardPicture(session, third, STYLE, DISPLAY);
    await vi.waitFor(() => expect(heldFoldCardPicture(third, STYLE, DISPLAY)).toBe(unspread));
    expect(analytics.track).toHaveBeenCalledTimes(2);
    expect(analytics.track).toHaveBeenLastCalledWith('fold spread refused', { reason: 'time_budget' });
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('still reports a spread that failed for any other reason, and leaves the card undrawn', async () => {
    const inconsistent = new Error('Invalid spread geometry: significant overlap missing layer order');
    solve.fails = inconsistent;
    const source = card('fs1:inconsistent');
    requestFoldCardPicture(session, source, STYLE, DISPLAY);
    await vi.waitFor(() => expect(monitoring.reportError).toHaveBeenCalledOnce());
    expect(monitoring.reportError).toHaveBeenCalledWith(inconsistent, { surface: 'fold:card-picture' });
    expect(heldFoldCardPicture(source, STYLE, DISPLAY)).toBeUndefined();
    expect(analytics.track).not.toHaveBeenCalled();
  });
});

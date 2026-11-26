import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStep, type DiagramStep } from '../document/diagramDocument';
import { FOLD_PULL_RENDER, type FoldPullPreviewRequest } from './foldPull';
import { clearFoldPullPreviews, foldPullPreviews, MAX_PREVIEWS, wantFoldPullPreview } from './foldPullPreviews';

const request = (step: string): FoldPullPreviewRequest => ({
  sequence: 'fold-a',
  target: { kind: 'step', step, moment: 'before' },
  render: FOLD_PULL_RENDER,
  key: `fold-a|${step}`,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const shown = (key: string) => foldPullPreviews.getState().byKey.get(key);

/** A capture that answers each request when told to, as the engine would in its own time. */
function heldCapture() {
  const answers = new Map<string, (preview: DiagramStep | null) => void>();
  const asked: string[] = [];
  const capture = vi.fn(
    (asking: FoldPullPreviewRequest) =>
      new Promise<DiagramStep | null>((resolve) => {
        asked.push(asking.target.step);
        answers.set(asking.key, resolve);
      })
  );
  const answer = async (step: string, preview: DiagramStep | null) => {
    answers.get(`fold-a|${step}`)?.(preview);
    await flush();
  };
  return { capture, asked, answer };
}

afterEach(() => clearFoldPullPreviews());

describe('the Fold browser’s card pictures', () => {
  it('captures what a card wants once, and shows it again at once', async () => {
    const { capture, answer } = heldCapture();
    const release = wantFoldPullPreview(request('a'), capture);
    // A second card, or the same one made again, while it is being captured.
    wantFoldPullPreview(request('a'), capture)();
    const step = createStep();
    await answer('a', step);
    expect(shown('fold-a|a')).toBe(step);
    release();
    wantFoldPullPreview(request('a'), capture);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(shown('fold-a|a')).toBe(step);
  });

  it('captures one at a time, in the order the cards asked', async () => {
    const { capture, asked, answer } = heldCapture();
    wantFoldPullPreview(request('a'), capture);
    wantFoldPullPreview(request('b'), capture);
    await flush();
    expect(asked).toEqual(['a']);
    await answer('a', createStep());
    expect(asked).toEqual(['a', 'b']);
  });

  it('passes over a card no longer wanted by its turn: the browser closed', async () => {
    const { capture, asked, answer } = heldCapture();
    wantFoldPullPreview(request('a'), capture);
    const closed = wantFoldPullPreview(request('b'), capture);
    wantFoldPullPreview(request('c'), capture);
    closed();
    await answer('a', createStep());
    expect(asked).toEqual(['a', 'c']);
  });

  it('asks again for a picture that came to nothing, once no card shows it', async () => {
    const { capture, answer } = heldCapture();
    const release = wantFoldPullPreview(request('a'), capture);
    await answer('a', null);
    expect(shown('fold-a|a')).toBeNull();
    release();
    expect(foldPullPreviews.getState().byKey.has('fold-a|a')).toBe(false);
    wantFoldPullPreview(request('a'), capture);
    await flush();
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('takes a capture that throws as nothing to draw', async () => {
    const capture = vi.fn(async (): Promise<DiagramStep | null> => {
      throw new Error('The engine stopped');
    });
    wantFoldPullPreview(request('a'), capture);
    await flush();
    expect(shown('fold-a|a')).toBeNull();
  });

  it('keeps no more than its cap, the oldest let go first, but never one a card shows', async () => {
    const capture = vi.fn(async () => createStep());
    const releases = Array.from({ length: MAX_PREVIEWS + 1 }, (_, index) => wantFoldPullPreview(request(`s${index}`), capture));
    await flush();
    // Every card still shows its own.
    expect(foldPullPreviews.getState().byKey.size).toBe(MAX_PREVIEWS + 1);
    for (const release of releases) release();
    wantFoldPullPreview(request('new'), capture);
    await flush();
    const kept = [...foldPullPreviews.getState().byKey.keys()];
    expect(kept).toHaveLength(MAX_PREVIEWS);
    expect(kept).not.toContain('fold-a|s0');
    expect(kept).not.toContain('fold-a|s1');
    expect(kept.at(-1)).toBe('fold-a|new');
  });
});

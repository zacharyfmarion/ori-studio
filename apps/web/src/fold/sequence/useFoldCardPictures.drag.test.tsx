import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { DEFAULT_LAYER_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { documentPaperStyleOf } from '../../lib/paper/documentPaperStyle';
import { FOLD_DEFAULT_PAPER_STYLE } from '../document/foldSequenceDocument';
import { bookScene } from '../canvas/foldCanvas.fixtures';
import { FOLD_PANE_DISPLAY_DEFAULT } from '../canvas/foldPaneScenes';
import type { FoldSession } from '../session/foldSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every picture painted, counted. */
const paints = vi.hoisted(() => ({ count: 0 }));
vi.mock('../canvas/foldStatePicture', async (importOriginal) => {
  const real = await importOriginal<typeof import('../canvas/foldStatePicture')>();
  return {
    ...real,
    foldStatePictureUrl: (...args: Parameters<typeof real.foldStatePictureUrl>) => {
      paints.count += 1;
      return real.foldStatePictureUrl(...args);
    },
  };
});

const app = vi.hoisted(() => ({ session: null as FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', () => ({ foldSession: () => app.session }));

const { SPREAD_SETTLE_MS, clearFoldCardPictures, foldCardPictureSource, heldFoldCardPicture, useFoldCardPicture } =
  await import('./useFoldCardPictures');

/** Every state's scene in hand, as the canvas and the frames have usually asked for it already. */
const scene = bookScene();
/** What a sequence with no style of its own is drawn in, and so what the cards here are painted in. */
const FOLD_STYLE = documentPaperStyleOf(FOLD_DEFAULT_PAPER_STYLE);
app.session = {
  peek: () => ({ value: scene }),
  query: () => Promise.resolve({ status: 'answered', value: scene }),
} as unknown as FoldSession;

const EARLY = 20;
const INHERITING = 8;
const MOVES = 30;

/** The strip's windowed cards: steps before the one dragged, and the ones that take its spread. */
function sources(spread: LayerSpreadOptions) {
  return {
    early: Array.from({ length: EARLY }, (_, k) => foldCardPictureSource({ generation: 1, id: 100 + k }, `fs1:early${k}`, null)!),
    inheriting: Array.from(
      { length: INHERITING },
      (_, k) => foldCardPictureSource({ generation: 1, id: k }, `fs1:card${k}`, spread)!
    ),
  };
}

let shown: (string | null | undefined)[][] = [];
function Card({ at, source }: { at: number; source: ReturnType<typeof foldCardPictureSource> }) {
  (shown[at] ??= []).push(useFoldCardPicture(source));
  return null;
}
function Strip({ spread }: { spread: LayerSpreadOptions }) {
  const { early, inheriting } = sources(spread);
  return (
    <>
      {[...early, ...inheriting].map((source, at) => (
        <Card key={at} at={at} source={source} />
      ))}
    </>
  );
}

const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const spreadAt = (move: number): LayerSpreadOptions => ({ ...DEFAULT_LAYER_SPREAD, amount: Number((0.03 + move * 0.002).toFixed(4)) });

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  shown = [];
  clearFoldCardPictures();
});

describe('a spread dragged over the step strip', () => {
  it('paints each inheriting card once it holds still, never blanks a card, and evicts none of the others', async () => {
    root = createRoot(document.createElement('div'));
    act(() => root?.render(<Strip spread={spreadAt(0)} />));
    await wait(SPREAD_SETTLE_MS);
    const before = sources(spreadAt(0));
    for (const source of [...before.early, ...before.inheriting]) {
      expect(heldFoldCardPicture(source, FOLD_STYLE, FOLD_PANE_DISPLAY_DEFAULT)).toMatch(/^data:image/);
    }

    paints.count = 0;
    shown = [];
    // A slider's ticks, about a frame apart: the strip renders between them, and the paint slices run.
    for (let move = 1; move <= MOVES; move += 1) {
      act(() => root?.render(<Strip spread={spreadAt(move)} />));
      await wait(16);
    }
    // The drag let go: the spread holds still, and the new pictures land.
    await wait(SPREAD_SETTLE_MS * 2);

    const after = sources(spreadAt(MOVES));
    // One picture per inheriting card: the spread it was let go at.
    expect(paints.count).toBe(INHERITING);
    for (const source of after.inheriting) {
      expect(heldFoldCardPicture(source, FOLD_STYLE, FOLD_PANE_DISPLAY_DEFAULT)).toMatch(/^data:image/);
    }
    // No card was ever blank on the way: each showed its last picture until the new one came.
    for (const renders of shown) expect(renders.every((picture) => typeof picture === 'string')).toBe(true);
    for (let k = 0; k < INHERITING; k += 1) {
      expect(shown[EARLY + k]?.at(-1)).toBe(heldFoldCardPicture(after.inheriting[k]!, FOLD_STYLE, FOLD_PANE_DISPLAY_DEFAULT));
    }
    // The cards the drag never touched kept theirs.
    for (const source of after.early) {
      expect(heldFoldCardPicture(source, FOLD_STYLE, FOLD_PANE_DISPLAY_DEFAULT)).toMatch(/^data:image/);
    }
    // And the spreads let go of are gone with the drag: no card wants them.
    expect(heldFoldCardPicture(before.inheriting[0]!, FOLD_STYLE, FOLD_PANE_DISPLAY_DEFAULT)).toBeUndefined();
  });
});

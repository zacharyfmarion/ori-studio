import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentPaperStyleOf } from '../../lib/paper/documentPaperStyle';
import { FOLD_DEFAULT_PAPER_STYLE } from '../document/foldSequenceDocument';
import { bookScene, flatSquareScene } from '../canvas/foldCanvas.fixtures';
import { resetFoldPaneDisplay, setFoldPaneDisplay } from '../canvas/foldPaneDisplay';
import { FOLD_PANE_DISPLAY_DEFAULT } from '../canvas/foldPaneScenes';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import type { FoldScene } from '../engine/foldEngineWire';
import type { FoldSession } from '../session/foldSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A session that knows some states' scenes: `held` ones are in hand
 * (`peek`), the rest are asked (`query`), and a state it does not know has
 * gone with its engine.
 */
function fakeSession(scenes: Map<number, FoldScene>, held: ReadonlySet<number> = new Set()) {
  const peek = vi.fn((state: FoldEngineStateHandle) => {
    const scene = held.has(state.id) ? scenes.get(state.id) : undefined;
    return scene ? { value: scene } : null;
  });
  const query = vi.fn((state: FoldEngineStateHandle) => {
    const scene = scenes.get(state.id);
    return Promise.resolve(scene ? { status: 'answered' as const, value: scene } : { status: 'unavailable' as const });
  });
  return { session: { peek, query } as unknown as FoldSession, peek, query };
}

const app = vi.hoisted(() => ({ session: null as FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', () => ({
  foldSession: () => app.session,
}));

const {
  clearFoldCardPictures,
  foldCardPictureSource,
  heldFoldCardPicture,
  requestFoldCardPicture,
  useFoldCardPicture,
} = await import('./useFoldCardPictures');

const handle = (id: number, generation = 1): FoldEngineStateHandle => ({ generation, id });
const DISPLAY = FOLD_PANE_DISPLAY_DEFAULT;
/** What a sequence with no style of its own is drawn in, and so what the cards here are painted in. */
const FOLD_STYLE = documentPaperStyleOf(FOLD_DEFAULT_PAPER_STYLE);

/** Let the asks answer and the paint slices run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  clearFoldCardPictures();
  resetFoldPaneDisplay();
  app.session = null;
});

describe('the step strip’s card pictures', () => {
  it('paints a state from the scene in hand, or asks for it, and keeps it', async () => {
    const { session, query } = fakeSession(new Map([[1, flatSquareScene()], [2, bookScene()]]), new Set([1]));
    const inHand = foldCardPictureSource(handle(1), 'fs1:aaaa');
    const asked = foldCardPictureSource(handle(2), 'fs1:bbbb');
    if (!inHand || !asked) throw new Error('no source');
    requestFoldCardPicture(session, inHand, FOLD_STYLE, DISPLAY);
    requestFoldCardPicture(session, asked, FOLD_STYLE, DISPLAY);
    // Painted a slice later, never during the ask.
    expect(heldFoldCardPicture(inHand, FOLD_STYLE, DISPLAY)).toBeUndefined();
    await settle();
    expect(heldFoldCardPicture(inHand, FOLD_STYLE, DISPLAY)).toMatch(/^data:image\/svg\+xml/);
    expect(heldFoldCardPicture(asked, FOLD_STYLE, DISPLAY)).toMatch(/^data:image\/svg\+xml/);
    expect(query).toHaveBeenCalledTimes(1);
    // Asked again: kept, so nothing is asked of the session.
    requestFoldCardPicture(session, asked, FOLD_STYLE, DISPLAY);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps a picture by the state’s fingerprint across handles, and by its handle without one', async () => {
    const { session, query } = fakeSession(new Map([[1, flatSquareScene()], [7, flatSquareScene()]]));
    const first = foldCardPictureSource(handle(1), 'fs1:same');
    const replayed = foldCardPictureSource(handle(7, 2), 'fs1:same');
    if (!first || !replayed) throw new Error('no source');
    requestFoldCardPicture(session, first, FOLD_STYLE, DISPLAY);
    await settle();
    // The same state under the next engine's handle: its picture is already painted.
    expect(heldFoldCardPicture(replayed, FOLD_STYLE, DISPLAY)).toBe(heldFoldCardPicture(first, FOLD_STYLE, DISPLAY));
    requestFoldCardPicture(session, replayed, FOLD_STYLE, DISPLAY);
    expect(query).toHaveBeenCalledTimes(1);
    // The step being folded has no fingerprint yet: its handle names it.
    expect(foldCardPictureSource(handle(9, 3))?.key).toBe('handle:3:9');
    expect(foldCardPictureSource(null)).toBeNull();
  });

  it('pictures one state once per spread, and cards of different spreads side by side', async () => {
    const { session, query } = fakeSession(new Map([[2, bookScene()]]), new Set([2]));
    const spread = { kind: 'depth' as const, amount: 0.1, toward: 'down' as const };
    const flat = foldCardPictureSource(handle(2), 'fs1:book');
    const spreadOut = foldCardPictureSource(handle(2), 'fs1:book', spread);
    const again = foldCardPictureSource(handle(2), 'fs1:book', { ...spread });
    if (!flat || !spreadOut || !again) throw new Error('no source');
    expect(spreadOut.spread).toBe(spread);
    // Both asked in one look: neither is a look no longer shown.
    requestFoldCardPicture(session, flat, FOLD_STYLE, DISPLAY);
    requestFoldCardPicture(session, spreadOut, FOLD_STYLE, DISPLAY);
    await settle();
    const unspread = heldFoldCardPicture(flat, FOLD_STYLE, DISPLAY);
    const spreadPicture = heldFoldCardPicture(spreadOut, FOLD_STYLE, DISPLAY);
    expect(unspread).toMatch(/^data:image\/svg\+xml/);
    expect(spreadPicture).toMatch(/^data:image\/svg\+xml/);
    expect(spreadPicture).not.toBe(unspread);
    // The same spread from another step is the same picture.
    expect(heldFoldCardPicture(again, FOLD_STYLE, DISPLAY)).toBe(spreadPicture);
    expect(query).not.toHaveBeenCalled();
  });

  it('paints only the look on show, and asks again for a state that went with its engine', async () => {
    const { session, query } = fakeSession(new Map([[1, flatSquareScene()]]), new Set([1]));
    const source = foldCardPictureSource(handle(1), 'fs1:look');
    const gone = foldCardPictureSource(handle(5), 'fs1:gone');
    if (!source || !gone) throw new Error('no source');
    const bare = { ...DISPLAY, precreases: false };
    // The switch flipped before the first slice ran: the first look is never painted.
    requestFoldCardPicture(session, source, FOLD_STYLE, DISPLAY);
    requestFoldCardPicture(session, source, FOLD_STYLE, bare);
    await settle();
    expect(heldFoldCardPicture(source, FOLD_STYLE, DISPLAY)).toBeUndefined();
    expect(heldFoldCardPicture(source, FOLD_STYLE, bare)).toMatch(/^data:image\/svg\+xml/);

    requestFoldCardPicture(session, gone, FOLD_STYLE, bare);
    await settle();
    expect(heldFoldCardPicture(gone, FOLD_STYLE, bare)).toBeUndefined();
    requestFoldCardPicture(session, gone, FOLD_STYLE, bare);
    await settle();
    expect(query.mock.calls.filter(([state]) => state.id === 5)).toHaveLength(2);
  });
});

describe('useFoldCardPicture', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it('is undefined while painting, the picture once painted, painted again for the Precreases switch', async () => {
    const { session } = fakeSession(new Map([[1, flatSquareScene()]]), new Set([1]));
    app.session = session;
    const source = foldCardPictureSource(handle(1), 'fs1:hook');
    const seen: (string | null | undefined)[] = [];
    function Probe() {
      seen.push(useFoldCardPicture(source));
      return null;
    }
    host = document.createElement('div');
    root = createRoot(host);
    act(() => root?.render(<Probe />));
    expect(seen.at(-1)).toBeUndefined();
    await settle();
    const painted = seen.at(-1);
    expect(painted).toMatch(/^data:image\/svg\+xml/);

    act(() => setFoldPaneDisplay({ ...DISPLAY, precreases: false }));
    expect(seen.at(-1)).toBeUndefined();
    await settle();
    expect(seen.at(-1)).toMatch(/^data:image\/svg\+xml/);
  });

  it('is null once its paint failed, not painting for ever, and asked again by a card that mounts later', async () => {
    const query = vi.fn(() => Promise.reject(new Error('no scene')));
    app.session = { peek: () => null, query } as unknown as FoldSession;
    const source = foldCardPictureSource(handle(3), 'fs1:fails');
    const seen: (string | null | undefined)[] = [];
    function Probe() {
      seen.push(useFoldCardPicture(source));
      return null;
    }
    host = document.createElement('div');
    root = createRoot(host);
    act(() => root?.render(<Probe />));
    expect(seen.at(-1)).toBeUndefined();
    await settle();
    expect(seen.at(-1)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);

    // Let go by every card, then shown again: on its way once more, and asked again.
    act(() => root?.render(null));
    act(() => root?.render(<Probe />));
    expect(seen.at(-1)).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('shows a step just committed with the picture its preview’s card painted under its handle, painting nothing', async () => {
    const { session, query } = fakeSession(new Map([[4, bookScene()]]), new Set([4]));
    app.session = session;
    const spread = { kind: 'depth' as const, amount: 0.1, toward: 'down' as const };
    // The step a tool is folding: no fingerprint, so its handle names it.
    const previewing = foldCardPictureSource(handle(4), null, spread);
    if (!previewing) throw new Error('no source');
    requestFoldCardPicture(session, previewing, FOLD_STYLE, DISPLAY);
    await settle();
    const painted = heldFoldCardPicture(previewing, FOLD_STYLE, DISPLAY);
    expect(painted).toMatch(/^data:image\/svg\+xml/);

    // Committed: the same state, now with its fingerprint, in the same spread.
    const committed = foldCardPictureSource(handle(4), 'fs1:committed', spread);
    const seen: (string | null | undefined)[] = [];
    function Probe({ source }: { source: typeof committed }) {
      seen.push(useFoldCardPicture(source));
      return null;
    }
    host = document.createElement('div');
    root = createRoot(host);
    act(() => root?.render(<Probe source={committed} />));
    expect(seen[0]).toBe(painted);
    expect(heldFoldCardPicture(committed!, FOLD_STYLE, DISPLAY)).toBeUndefined();
    act(() => root?.unmount());

    // Another spread is another picture: a card of the state without it is painted, as ever.
    const unspread: (string | null | undefined)[] = [];
    function Unspread() {
      unspread.push(useFoldCardPicture(foldCardPictureSource(handle(4), 'fs1:committed')));
      return null;
    }
    root = createRoot(host);
    act(() => root?.render(<Unspread />));
    expect(unspread[0]).toBeUndefined();
    await settle();
    expect(unspread.at(-1)).toMatch(/^data:image\/svg\+xml/);
    expect(unspread.at(-1)).not.toBe(painted);
    expect(query).not.toHaveBeenCalled();
  });

  it('is null for a card with no state', () => {
    app.session = fakeSession(new Map()).session;
    let seen: string | null | undefined;
    function Probe() {
      seen = useFoldCardPicture(null);
      return null;
    }
    host = document.createElement('div');
    root = createRoot(host);
    act(() => root?.render(<Probe />));
    expect(seen).toBeNull();
  });
});

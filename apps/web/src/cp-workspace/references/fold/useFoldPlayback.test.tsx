import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldScene } from './foldScene';
import type { FoldPoseSink } from './foldTransport';
import { useFoldPlayback } from './useFoldPlayback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.hoisted(() => vi.fn());
vi.mock('../../../analytics', () => ({
  ANALYTICS_EVENTS: { referencesFoldPlayed: 'references fold played' },
  track,
}));

const SCENE: FoldScene = { kind: 'cp', flaps: [], sheetShortSide: 1, reach: 1 };

const sink: FoldPoseSink = { setFoldPose: vi.fn() };
const view = { current: sink };

/** The controller's facts as attributes, and its verb as a button: no globals. */
function Probe({ scene, autoPlay }: { scene: FoldScene | null; autoPlay: boolean }) {
  const fold = useFoldPlayback({ view, scene, autoPlay });
  return (
    <button
      type="button"
      data-available={String(fold.available)}
      data-playing={String(fold.playing)}
      data-folded={String(fold.folded)}
      onClick={fold.toggle}
    />
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const probe = () => container?.querySelector('button');

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.mocked(sink.setFoldPose).mockClear();
  track.mockClear();
  vi.unstubAllGlobals();
});

describe('useFoldPlayback', () => {
  it('binds the transport to the card, the button and the analytics event', () => {
    act(() => root?.render(<Probe scene={null} autoPlay={false} />));
    expect(probe()?.dataset.available).toBe('false');
    act(() => root?.render(<Probe scene={SCENE} autoPlay={false} />));
    expect(probe()?.dataset.available).toBe('true');
    expect(probe()?.dataset.folded).toBe('false');
    // Reduced motion is stubbed on, so a press lands at the far end at once.
    act(() => probe()?.click());
    expect(probe()?.dataset.folded).toBe('true');
    expect(sink.setFoldPose).toHaveBeenLastCalledWith({ angle: Math.PI, press: 1 });
    expect(track).toHaveBeenCalledWith('references fold played', {
      trigger: 'user',
      direction: 'fold',
      step_kind: 'cp',
    });
    act(() => probe()?.click());
    expect(probe()?.dataset.folded).toBe('false');
    expect(sink.setFoldPose).toHaveBeenLastCalledWith(null);
  });
});
